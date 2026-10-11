"""Model manager — loads every ONNX session exactly once, thread-safe.

Owns:
  * YuNet face detector (via cv2.FaceDetectorYN — OpenCV-native wrapper that
    handles the 640x640 pre/post-processing, NMS and 5-point landmarks)
  * SFace recognizer (via cv2.FaceRecognizerSF — handles the 112x112 crop
    convention and 128-D feature extraction)
  * MiniFASNet anti-spoof ensemble (2 ONNX sessions run via onnxruntime)

The manager refuses computation until initialize() succeeds — callers get a
clean FACE_MODEL_NOT_READY (503) instead of a traceback.
"""
from __future__ import annotations

import logging
import threading

import cv2
import numpy as np
import onnxruntime as ort

from ..config import settings
from .exceptions import ModelNotReadyError

logger = logging.getLogger("biometric.models")


class FaceModelManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ready = False
        self.detector: cv2.FaceDetectorYN | None = None
        self.recognizer: cv2.FaceRecognizerSF | None = None
        # Anti-spoof ensemble: (session, crop_scale) — scale from the filename
        # convention ("2.7_80x80" → 2.7, "4_0_0_80x80" → 4.0), per the
        # reference preprocessing of Silent-Face-Anti-Spoofing.
        self.antispoof_with_scale: list[tuple[ort.InferenceSession, float]] = []
        self.antispoof_sessions: list[ort.InferenceSession] = []
        self.antispoof_input_name: str = "input"

    # ── lifecycle ────────────────────────────────────────────────────────
    def initialize(self) -> None:
        with self._lock:
            if self._ready:
                return

            providers = ["CPUExecutionProvider"]
            # CUDA → CPU fallback probe: attempt GPU only if the provider is
            # actually registered; never crash the service on a missing GPU.
            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available:
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
            logger.info("onnxruntime providers: %s (using %s)", available, providers[0])

            # YuNet — OpenCV DNN wrapper.
            detector = cv2.FaceDetectorYN.create(
                settings.yunet_model_path,
                config="",
                input_size=(settings.yunet_input_size, settings.yunet_input_size),
                score_threshold=settings.face_min_detection_confidence,
                nms_threshold=0.3,
                top_k=5000,
                backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                target_id=cv2.dnn.DNN_TARGET_CPU,
            )

            # SFace — OpenCV DNN wrapper.
            recognizer = cv2.FaceRecognizerSF.create(
                settings.sface_model_path, config=""
            )

            # Anti-spoof ensemble — raw onnxruntime sessions + per-model scale.
            from ..face.liveness import parse_scale

            sessions: list[ort.InferenceSession] = []
            pairs: list[tuple[ort.InferenceSession, float]] = []
            for path in settings.antispoof_model_paths:
                sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
                sessions.append(sess)
                pairs.append((sess, parse_scale(path)))
            if not sessions:
                raise RuntimeError("anti-spoof ensemble is empty — refusing to start")
            input_name = sessions[0].get_inputs()[0].name

            self.detector = detector
            self.recognizer = recognizer
            self.antispoof_sessions = sessions
            self.antispoof_with_scale = pairs
            self.antispoof_input_name = input_name
            self._ready = True
            logger.info(
                "models ready: yunet=%s sface=%s antispoof=%d session(s)",
                settings.yunet_model_path.split("/")[-1],
                settings.sface_model_path.split("/")[-1],
                len(sessions),
            )

    @property
    def ready(self) -> bool:
        return self._ready

    def require_ready(self) -> None:
        if not self._ready:
            raise ModelNotReadyError("biometric models are still loading")

    # ── accessors ────────────────────────────────────────────────────────
    def set_detector_input_size(self, width: int, height: int) -> None:
        """YuNet needs the frame size set per capture for best accuracy."""
        if self.detector is not None:
            self.detector.setInputSize((int(width), int(height)))

    def score_threshold_sync(self) -> None:
        """Push the configured detection threshold into the detector."""
        if self.detector is not None:
            self.detector.setScoreThreshold(settings.face_min_detection_confidence)

    def run_antispoof(self, blob: np.ndarray) -> list[np.ndarray]:
        """Run the ensemble on one preprocessed batch; returns list of logits.

        NOTE: the pipeline normally uses `antispoof_with_scale` because each
        model requires its own crop scale. This helper exists for uniform
        blobs (e.g. tests).
        """
        self.require_ready()
        outputs: list[np.ndarray] = []
        for sess in self.antispoof_sessions:
            outputs.append(
                sess.run(None, {self.antispoof_input_name: blob})[0]
            )
        return outputs


# Process-wide singleton.
model_manager = FaceModelManager()

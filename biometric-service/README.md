# EduTrack Biometric Service

A real, server-side face biometric engine for the EduTrack attendance system.

**FastAPI · OpenCV DNN · ONNX Runtime (CPU) · Python 3.10+**

This service is the **single authority** for all biometric computation. The
browser captures raw camera frames and sends them to the EduTrack Next.js
application, which forwards them here after authentication. Every decision —
detection, quality, liveness (anti-spoof), identity — is computed by this
service from real inference. The browser never produces embeddings, scores or
verdicts, and the service never talks to browsers directly.

## Pipeline (per spec PART 8)

```
FRAME(s) → DECODE → DETECT (YuNet) → EXACTLY-ONE-FACE → QUALITY
        → LANDMARKS → ALIGNMENT (5-pt, 112×112) → LIVENESS (MiniFASNet ×2)
        → SFACE EMBED (128-D, L2) → AGGREGATE (multi-frame centroid)
        → MATCH (1:1 SELF / 1:N KIOSK with margin) → decision
```

## Model stack and licensing (spec PHASE 6)

| Role | Model | License |
|---|---|---|
| Detection + 5-pt landmarks | YuNet `face_detection_yunet_2023mar` | MIT (OpenCV Zoo) |
| Recognition embeddings | SFace `face_recognition_sface_2021dec` (128-D) | Apache-2.0 (OpenCV Zoo) |
| Liveness / anti-spoof | MiniFASNet V2 + V1SE (Silent-Face-Anti-Spoofing) | Apache-2.0 |
| Blur / brightness / pose | OpenCV (Variance of Laplacian etc.) | Apache-2.0 |

> **Why not InsightFace/buffalo?** InsightFace's *code* is MIT, but **all**
> its pretrained model packs (buffalo_*, antelopev2) are licensed for
> **non-commercial research only**. Deploying them in a production attendance
> system is not permitted. The InsightFace library is therefore not used at
> all (its `FaceAnalysis` auto-downloads those weights). The model layer is
> config-driven, so a swap after obtaining commercial licensing is trivial.

All weights live in `../public/biometric-models/` so the production build
packages them automatically.

## Layout

```
app/
  main.py                     FastAPI app (lifespan: model init)
  config.py                   ALL thresholds (env-tunable, clamped)
  api/health.py               GET /health, GET /ready
  api/enrollment.py           POST /enroll   (internal token)
  api/verification.py         POST /verify   (internal token)
  core/model_manager.py       ONNX sessions, CUDA→CPU fallback
  core/security.py            internal token + sliding-window rate limits
  core/exceptions.py          code-first error taxonomy (422-class failures)
  face/detection.py           YuNet wrapper
  face/quality.py             structured quality report (blur/brightness/pose/size)
  face/alignment.py           canonical 5-point alignment
  face/embedding.py           SFace embedding + centroid aggregation
  face/liveness.py            anti-spoof ensemble (LIVE/FAKE/UNCERTAIN/INPUT_REJECTED)
  face/matcher.py             cosine bands, 1:1 / 1:N + ambiguity margin
  face/pipeline.py            orchestration of every stage
  services/                   enrollment_service, verification_service
  schemas/schemas.py          Pydantic request models
  repositories/
    biometric_repository.py   READ-ONLY template access over the shared DB
scripts/reset_student_data.py destructive data reset (admin tool)
tests/test_e2e_inference.py   REAL-inference E2E suite (20 checks)
tests/fixtures/               AI-generated CV test images (not user data)
```

## API

All biometric endpoints require the shared internal token
(`X-Internal-Token` header, from `BIOMETRIC_INTERNAL_TOKEN`). The Next.js
server is the only intended caller; browsers can never reach biometric data
except through the authenticated application routes.

### `POST /enroll`
```json
{ "frames": ["<base64 jpeg>", "..."] }        // 3–8 frames
```
→ `200 { ok, embedding[128], quality[], liveness, model, samples_used }`
→ `422 { ok:false, code: NO_FACE | MULTIPLE_FACES | LOW_IMAGE_QUALITY |
          LIVENESS_FAILED | INSUFFICIENT_FRAMES | INPUT_REJECTED }`

### `POST /verify`
```json
{ "frames": ["..."], "mode": "SELF" | "KIOSK", "student_id": "…(SELF only)" }
```
→ `200 { ok, matched, similarity, band, threshold, liveness, quality, … }`

### `GET /health` · `GET /ready`

## Thresholds

Every threshold is an env var with a clamped safe range (see `app/config.py`):
`FACE_MIN_DETECTION_CONFIDENCE`, `FACE_MIN_SIZE`, `FACE_QUALITY_THRESHOLD`,
`BLUR_THRESHOLD`, `BRIGHTNESS_MIN/MAX`, `MAX_YAW/PITCH/ROLL`,
`LIVENESS_PASS_THRESHOLD`, `LIVENESS_FAKE_THRESHOLD`, `FACE_MATCH_THRESHOLD`,
`FACE_HIGH_CONFIDENCE_THRESHOLD`, `FACE_MIN_MARGIN`, `BIOMETRIC_MIN/MAX_FRAMES`.

SFace cosine calibration (measured, real inference): genuine ≈ 1.0,
measured impostor pair 0.4294, published EER 0.363 → defaults
`FACE_MATCH_THRESHOLD=0.52`, `FACE_HIGH_CONFIDENCE_THRESHOLD=0.70`. The
application additionally requires a second confirming scan for medium-band
matches before marking attendance.

## Run (development)

```bash
cd biometric-service
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
export BIOMETRIC_INTERNAL_TOKEN=<same as Next.js .env>
export BIOMETRIC_DATABASE_PATH=/home/z/my-project/db/custom.db
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 3010
```

In production the `mini-services/biometric-bridge` supervisor launches this
service automatically (next-service-dist/biometric-service + packaged
python-runtime), and `requirements.txt` at the repo root feeds the build.

## Tests

```bash
.venv/bin/python tests/test_e2e_inference.py   # 20 real-inference checks
```

Covers: token security, enrollment (quality/liveness/template), 1:1 match,
stranger rejection, 1:N identification with margin, print/replay spoof
rejection (FAKE P(real)=0.0001), MULTIPLE_FACES, NO_FACE, INSUFFICIENT_FRAMES.

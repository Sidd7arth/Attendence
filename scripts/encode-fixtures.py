import base64
import json
from pathlib import Path
import cv2

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "biometric-service" / "tests" / "fixtures"

def encode(img_path: Path, brighten: bool = False) -> str:
    img = cv2.imread(str(img_path))
    if img is None:
        raise ValueError(f"Cannot load image {img_path}")
    if brighten:
        img = cv2.convertScaleAbs(img, alpha=1.25, beta=28)
    h, w = img.shape[:2]
    if w > 720:
        img = cv2.resize(img, (720, int(h * 720 / w)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise ValueError("Cannot encode jpeg")
    return base64.b64encode(buf.tobytes()).decode("utf-8")

data = {
    "a1": encode(FIX / "identity_a1.png", brighten=True),
    "a1_normal": encode(FIX / "identity_a1.png", brighten=False),
    "a3": encode(FIX / "identity_a3.png", brighten=False),
}
print(json.dumps(data))

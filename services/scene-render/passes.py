"""The gateway's quick render passes (supabase/functions/dream-gateway/scene-render.ts), checked: base64url(claims) and
its HMAC-SHA256 under the secret both share, base64url, joined by a dot."""
import base64
import hashlib
import hmac
import json
import time


def check_pass(token: str, key: str, frames: int) -> str:
    """The account id the gateway's pass names, if the pass is good, unexpired and covers this many frames."""
    try:
        body, signature = token.split(".", 1)
        expected = base64.urlsafe_b64encode(hmac.new(key.encode(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        if not hmac.compare_digest(expected, signature):
            raise ValueError
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:
        raise PermissionError("This quick render pass is not valid.")
    if claims.get("exp", 0) < time.time():
        raise PermissionError("This quick render pass ran out. Export again.")
    if frames > claims.get("frames", 0):
        raise PermissionError("This scene is longer than quick render draws.")
    return str(claims.get("sub", ""))

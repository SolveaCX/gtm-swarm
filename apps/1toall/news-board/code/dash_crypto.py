# 看板加密(CryptoJS兼容,http可用): PBKDF2-SHA256 + AES-256-CBC + PKCS7 + 信封加密(多密码)。
# 信封: 正文用固定主钥 MASTER 加密一次(每页一份密文);每个登录密码各存一份"被自己加密的 MASTER 副本"。
#       登录时: 密码→PBKDF2→解开某份 MASTER 副本→用 MASTER 解正文。任何密码都看不到别的密码,也看不到 MASTER 明文。
# MAGIC 头做校验(CBC 无认证,错密码解出乱码→头不对即拒)。
import base64, hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes, padding
SALT = bytes([0x37,0x41,0x7a,0x5b,0x11,0xc8,0x9d,0x2e,0x64,0xf0,0xa3,0x19,0x88,0x5c,0xd7,0x42])
ITER = 100000
MAGIC = "OK\n"
# 固定主钥:仅存在于本文件(服务端),绝不进任何输出。改它=作废所有已登录会话。
MASTER = hashlib.sha256(b"477-news-dashboard-master-key-2026").digest()   # 32 bytes = AES-256

def _key(pw):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=SALT, iterations=ITER).derive(pw.encode())

def _enc(key, plaintext_bytes):
    """AES-256-CBC,IV由(明文+key)确定→同内容同密文,无每日churn。返回 base64(iv+ct)。"""
    iv = hashlib.sha256(plaintext_bytes + key).digest()[:16]
    pad = padding.PKCS7(128).padder(); data = pad.update(plaintext_bytes) + pad.finalize()
    enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ct = enc.update(data) + enc.finalize()
    return base64.b64encode(iv + ct).decode()

def encrypt_content(inner):
    """正文用 MASTER 加密(每页调一次)。"""
    return _enc(MASTER, (MAGIC + inner).encode())

def wrap_master(pw):
    """把 MASTER 用某个登录密码包一层(全站只需算一次,与页面内容无关)。"""
    return _enc(_key(pw), (MAGIC + base64.b64encode(MASTER).decode()).encode())

SALT_JS = "[" + ",".join(str(b) for b in SALT) + "]"

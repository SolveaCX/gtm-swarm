// 纯 JS 解 zip：只用 Node 内置 zlib，不依赖系统 unzip（线上服务器没装，实测踩过）。
// 支持 store(0) 与 deflate(8) 两种压缩方式——日常导出包全是这两种。
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

// 从尾部找 End Of Central Directory（可能有注释，最多回溯 64KB）
function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * 列出 zip 里的条目。返回 [{ name, size, read() }]，read() 才真正解压该条目。
 * 目录项与 __MACOSX/.DS_Store 之类的垃圾直接跳过。
 */
export function listZip(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 zip 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central directory 起点
  const out = [];
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== CEN_SIG) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const rawSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;

    const base = name.split('/').pop() || '';
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || base.startsWith('.') || !base) continue;

    out.push({
      name,
      size: rawSize,
      read() {
        // local file header：名字与 extra 的长度可能和中央目录不同，必须重读
        const lnLen = buf.readUInt16LE(localOff + 26);
        const leLen = buf.readUInt16LE(localOff + 28);
        const start = localOff + 30 + lnLen + leLen;
        const chunk = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(chunk);
        if (method === 8) return zlib.inflateRawSync(chunk);
        throw new Error(`不支持的压缩方式 ${method}（${name}）`);
      },
    });
  }
  return out;
}


let imageIndex = {}; // key: tên chuẩn hoá (không đuôi), value: File

function normalize(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bỏ dấu tiếng Việt
    .toUpperCase()
    .trim()
    .replace(/[\s/-]+/g, '_');

}
function extractPrefix(name) {
  const match = normalize(name).match(/^([A-Z0-9]+)_/);
  
  return match? match[1]  : null;
}
function parseNameLine(line) {
  // khớp "dct_s86_001 x3", "dct_s86_001x3", "dct_s86_001 X 3"...
  const match = line.match(/^(.+?)\s*[xX]\s*(\d+)$/);
  if (match) {
    return { name: match[1].trim(), count: parseInt(match[2], 10) };
  }
  return { name: line, count: 1 }; // không có "xN" → mặc định 1 ảnh
}

//const IMAGE_BASE_URL = 'https://cdn.jsdelivr.net/gh/kuuhaku15022006/Weiss_proxy@main/images/';
//const IMAGE_BASE_URL = 'https://raw.githubusercontent.com/kuuhaku15022006/Weiss_proxy/main/images/';
const IMAGE_BASE_URL = 'https://pub-e948ec5fe47a422eaf688803114906d4.r2.dev/';


async function fetchCardImage(name) {
  const prefix = extractPrefix(name);
  if (!prefix) return null; // tên không đúng định dạng "prefix_..."

  const key = normalize(name);
  const baseUrl = `${IMAGE_BASE_URL}${prefix}/`; // ghép thẳng prefix làm tên thư mục

  for (const ext of ['PNG', 'JPG', 'JPEG', 'WEBP']) {
    const url = `${baseUrl}${key}.${ext}`;
    const res = await fetch(url);
    if (res.ok) return await res.arrayBuffer();
  }
  return null;
}


async function matchImages() {
  const lines = document.getElementById('nameList').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const parsed = lines.map(parseNameLine); // [{name, count}, ...]
  const matched = [];
  const missing = [];
  const cache = {}; // key: tên chuẩn hoá, value: bytes đã tải (tránh fetch lại nếu trùng tên)

  for (const { name, count } of parsed) {
    const key = normalize(name);

    if (!(key in cache)) {
      cache[key] = await fetchCardImage(name); // chỉ fetch khi chưa có trong cache
    }
    const bytes = cache[key];

    if (bytes) {
      for (let i = 0; i < count; i++) {
        matched.push({ name, bytes }); // đẩy đúng số lượng bản sao vào matched
      }
    } else {
      missing.push(name);
    }
  }

  if (missing.length) {
    alert('Không tìm thấy ảnh cho: ' + missing.join(', '));
  }
  return matched;
}

// Ví dụ: khổ A4 (595 x 842 point), lưới 3 cột x 3 hàng, mỗi ô 63x88mm (theo point: 1mm ≈ 2.83pt)
const PAGE = { width: 595, height: 842 };

const CELL_W = 178.6; // ~63mm
const CELL_H = 249.5; // ~88mm
const MARGIN_X = 20;
const MARGIN_Y = 20;
const GAP = 4;

function buildGridTemplate(cols = 3, rows = 3) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: MARGIN_X + c * (CELL_W + GAP),
        y: PAGE.height - MARGIN_Y - (r + 1) * CELL_H - r * GAP, // pdf-lib gốc toạ độ ở dưới-trái
        width: CELL_W,
        height: CELL_H
      });
    }
  }
  return cells; // 9 ô/trang
}
function drawCutMarks(page, cell) {
  const len = 6; // độ dài vạch, point
  const { rgb } = PDFLib;
  const corners = [
    [cell.x, cell.y], [cell.x + cell.width, cell.y],
    [cell.x, cell.y + cell.height], [cell.x + cell.width, cell.y + cell.height]
  ];
  for (const [cx, cy] of corners) {
    page.drawLine({ start: { x: cx - len, y: cy }, end: { x: cx + len, y: cy }, thickness: 0.5, color: rgb(0,0,0) });
    page.drawLine({ start: { x: cx, y: cy - len }, end: { x: cx, y: cy + len }, thickness: 0.5, color: rgb(0,0,0) });
  }
}
// gọi sau mỗi lần page.drawImage(img, cell) trong vòng lặp export ở mục 6A

async function exportPdf() {
  const matched = await matchImages(); // ← nhớ thêm await vì matchImages giờ là async
  if (!matched.length) return;

  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const template = buildGridTemplate(3, 3);
  const perPage = template.length;

  for (let i = 0; i < matched.length; i += perPage) {
    const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
    const group = matched.slice(i, i + perPage);

    for (let j = 0; j < group.length; j++) {
      const { bytes } = group[j]; // ← lấy bytes trực tiếp, không cần file nữa

      let img;
      try {
        img = await pdfDoc.embedPng(bytes);
      } catch {
        img = await pdfDoc.embedJpg(bytes); // thử jpg nếu không phải png
      }

      const cell = template[j];
      page.drawImage(img, { x: cell.x, y: cell.y, width: cell.width, height: cell.height });
      drawCutMarks(page, cell);
    }
  }

  const pdfBytes = await pdfDoc.save();
  downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), 'proxy.pdf');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);

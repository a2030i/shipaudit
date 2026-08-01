// دمج ملفات PDF داخل المتصفح: لا تُرسل الفواتير إلى خدمة خارجية، وتبقى
// صلاحية جلب كل مستند خاضعة لدالة zoho-sync نفسها.
export async function mergePdfBlobs(blobs) {
  if (!Array.isArray(blobs) || !blobs.length) throw new Error('لم تُحدَّد ملفات PDF للدمج');

  // تحميل مكتبة الدمج فقط عند طلب PDF موحّد؛ لا نحمّلها مع كل زيارة للصفحة.
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  for (const blob of blobs) {
    if (!(blob instanceof Blob) || !blob.size) throw new Error('أحد ملفات PDF فارغ');
    const source = await PDFDocument.load(await blob.arrayBuffer());
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach(page => merged.addPage(page));
  }

  const bytes = await merged.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

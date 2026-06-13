// Downscale + re-encode a captured photo before storing it.
// Phone photos can be 5-12 MB each; we keep them readable but small so that
// many of them fit comfortably in IndexedDB and upload quickly when online.
//
// IMPORTANT: EXIF must be read from the ORIGINAL file (see photoMeta.js)
// before calling this — canvas re-encoding strips EXIF.

const MAX_EDGE = 1600 // px on the longest side
const QUALITY = 0.82

/**
 * @param {File|Blob} file
 * @returns {Promise<Blob>} a JPEG blob (falls back to the original on failure)
 */
export async function compressImage(file) {
  try {
    const bitmap = await loadBitmap(file)
    const { width, height } = fit(bitmap.width, bitmap.height, MAX_EDGE)

    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height })
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    if (bitmap.close) bitmap.close()

    const blob = await toBlob(canvas)
    return blob && blob.size > 0 ? blob : file
  } catch {
    return file
  }
}

function fit(w, h, maxEdge) {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h }
  const scale = maxEdge / Math.max(w, h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(file)
  }
  // Fallback path for browsers without createImageBitmap: an <img> element is
  // itself drawable by ctx.drawImage and exposes width/height once decoded.
  const url = URL.createObjectURL(file)
  const img = await new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = url
  })
  URL.revokeObjectURL(url)
  // Normalise the dimension props fit()/drawImage rely on.
  img.width = img.naturalWidth
  img.height = img.naturalHeight
  return img
}

async function toBlob(canvas) {
  if (canvas.convertToBlob) return await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
  return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY))
}

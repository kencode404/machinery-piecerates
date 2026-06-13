// Hybrid timestamp + GPS extraction for a photo file.
//
// Strategy (chosen with the user):
//   1. Try to read GPS + original timestamp from the photo's EXIF.
//      Gallery uploads usually keep this; it is the most trustworthy source.
//   2. If the file has no GPS, fall back to the live device GPS captured at the
//      moment the photo is added to the form.
//   3. If the file has no timestamp, fall back to "now".
// The source of each value is recorded so the admin can see how it was obtained.

import exifr from 'exifr'
import { GpsSource } from '../db/models.js'

/**
 * Read whatever GPS + time we can from the file's EXIF.
 * @returns {{time: Date|null, lat: number|null, lng: number|null, hasGps: boolean}}
 */
export async function readExif(file) {
  try {
    const data = await exifr.parse(file, {
      gps: true,
      // these tags carry the original capture time
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'GPSLatitude', 'GPSLongitude']
    })
    if (!data) return { time: null, lat: null, lng: null, hasGps: false }

    const lat = typeof data.latitude === 'number' ? data.latitude : null
    const lng = typeof data.longitude === 'number' ? data.longitude : null
    const rawTime = data.DateTimeOriginal || data.CreateDate || data.ModifyDate || null
    const time = rawTime ? new Date(rawTime) : null
    return {
      time: isValidDate(time) ? time : null,
      lat,
      lng,
      hasGps: lat != null && lng != null
    }
  } catch {
    return { time: null, lat: null, lng: null, hasGps: false }
  }
}

/** One-shot live device position, resolves null on denial/timeout/no-support. */
export function getDevicePosition(timeoutMs = 9000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    )
  })
}

/**
 * Full hybrid capture for one photo file.
 * @param {File|Blob} file
 * @returns {Promise<{ capturedAt: string, gps: import('../db/models.js').GeoPoint, timeSource: string }>}
 */
export async function capturePhotoMeta(file) {
  const now = new Date()
  const exif = await readExif(file)

  let lat = exif.lat
  let lng = exif.lng
  let gpsSource = exif.hasGps ? GpsSource.EXIF : GpsSource.NONE

  if (!exif.hasGps) {
    const dev = await getDevicePosition()
    if (dev) {
      lat = dev.lat
      lng = dev.lng
      gpsSource = GpsSource.DEVICE
      return {
        capturedAt: (exif.time || now).toISOString(),
        timeSource: exif.time ? GpsSource.EXIF : GpsSource.DEVICE,
        gps: { lat, lng, source: gpsSource, accuracy: dev.accuracy }
      }
    }
  }

  return {
    capturedAt: (exif.time || now).toISOString(),
    timeSource: exif.time ? GpsSource.EXIF : GpsSource.DEVICE,
    gps: { lat, lng, source: gpsSource, accuracy: null }
  }
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

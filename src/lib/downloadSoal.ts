import { latexKeTeks } from './latexText'
export interface SoalDownload {
  id: string
  pertanyaan: string
  tipe: string
  tingkat_kesulitan: string
  bobot: number
  bab_id_text: string
  pilihan: Array<{ id: number; teks: string; benar: boolean }> | null
  pilihan_gambar?: string[]
  status: string
  revision_notes?: string | null
}

export interface SoalProcessed {
  id: string
  tipe: string
  tingkat_kesulitan: string
  bobot: number
  bab_id_text: string
  status: string
  pertanyaan_text: string
  pertanyaan_images: string[]
  pilihan: Array<{
    id: number
    teks_plain: string
    benar: boolean
    gambar_url: string | null
  }> | null
}

export interface PdfMeta {
  judul: string
  tanggal: string
  namaGuru?: string
  kelas?: string
  matrixData?: { bab_id_text: string; data: Record<string, number> }[]
}

export { latexKeTeks }

export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Rumus bentuk baru: node atom ber-data-latex, tanpa teks anak.
  doc.querySelectorAll('span[data-latex]').forEach(el => {
    el.replaceWith(latexKeTeks(el.getAttribute('data-latex') ?? ''))
  })

  // Bentuk LAMA. Dipertahankan supaya soal yang ditulis sebelum penyatuan
  // format tetap terbaca di PDF, walau editornya sudah tidak memproduksinya.
  doc.querySelectorAll('.math-frac').forEach(el => {
    const num = el.querySelector('.math-num')?.textContent ?? ''
    const den = el.querySelector('.math-den')?.textContent ?? ''
    el.replaceWith(`[${num}/${den}]`)
  })

  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function extractImages(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('img'))
    .map(img => img.getAttribute('src') ?? '')
    .filter(src => /^https?:\/\//.test(src))
}

export async function convertImageToJpegDataUrl(url: string): Promise<string | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject()
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return null
  }
}

export function processSoal(raw: SoalDownload[]): SoalProcessed[] {
  // Saring elemen kosong (null/undefined) DULU: satu lubang di larik soal
  // membuat `s.id` melempar "s is undefined" dan merobohkan SELURUH download PDF
  // (error tertelan senyap di pemanggil). Ditemukan pada ujian Qur'an.
  return raw.filter(Boolean).map(s => ({
    id: s.id,
    tipe: s.tipe,
    tingkat_kesulitan: s.tingkat_kesulitan,
    bobot: s.bobot,
    bab_id_text: s.bab_id_text,
    status: s.status,
    pertanyaan_text: htmlToPlainText(s.pertanyaan),
    pertanyaan_images: extractImages(s.pertanyaan),
    pilihan: s.pilihan?.map((p, i) => ({
      id: p.id,
      teks_plain: htmlToPlainText(p.teks),
      benar: p.benar,
      gambar_url: s.pilihan_gambar?.[i] ?? null,
    })) ?? null,
  }))
}

const TIPE_EXPORT_MAP: Record<string, string> = {
  pilgan: 'pilihan_ganda',
  essay: 'esai',
  ceklist: 'ceklist',
  isian_singkat: 'isian_singkat',
  benar_salah: 'benar_salah',
  pilgan_kategori: 'pilihan_ganda_kategori',
}

export function downloadJSON(soalList: SoalDownload[], filename: string): void {
  const mapped = soalList.filter(Boolean).map(s => {
    const tipe = TIPE_EXPORT_MAP[s.tipe] ?? s.tipe
    const pertanyaan = htmlToPlainText(s.pertanyaan)
    const gambar = extractImages(s.pertanyaan)[0]
    const pilihanTeks = s.pilihan?.map(p => htmlToPlainText(p.teks)) ?? []

    const obj: Record<string, unknown> = { pertanyaan, tipe }

    if (tipe === 'pilihan_ganda') {
      obj.pilihan = pilihanTeks
      const idx = s.pilihan?.findIndex(p => p.benar) ?? -1
      if (idx >= 0) obj.jawaban_benar = idx
    } else if (tipe === 'ceklist') {
      obj.items = pilihanTeks
      obj.jawaban_benar = s.pilihan?.reduce<number[]>((acc, p, i) => (p.benar ? [...acc, i] : acc), []) ?? []
    } else if (tipe === 'isian_singkat') {
      const kunci = s.pilihan?.find(p => p.benar) ?? s.pilihan?.[0]
      obj.pilihan = kunci ? [htmlToPlainText(kunci.teks)] : []
    } else if (tipe === 'benar_salah') {
      const idx = s.pilihan?.findIndex(p => p.benar) ?? 0
      obj.jawaban_benar = idx >= 0 ? idx : 0
    }

    obj.bobot = s.bobot
    obj.tingkat_kesulitan = s.tingkat_kesulitan
    if (gambar) obj.gambar_url = gambar
    if (s.bab_id_text) obj.nama_bab = s.bab_id_text

    return obj
  })

  const blob = new Blob([JSON.stringify(mapped, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function sampleSoalByMatrix(
  soalList: SoalDownload[],
  matrixData: { bab_id_text: string; data: Record<string, number> }[]
): SoalDownload[] {
  const result: SoalDownload[] = []

  for (const bab of matrixData) {
    for (const [key, target] of Object.entries(bab.data)) {
      if (!target) continue
      // Keys are stored as "tipe_kesulitan_keluar" / "tipe_kesulitan_bank"
      // Only use _keluar values (how many should appear in the exam)
      if (!key.endsWith('_keluar')) continue
      const baseKey = key.slice(0, -'_keluar'.length)
      const lastIdx = baseKey.lastIndexOf('_')
      const tipe = baseKey.slice(0, lastIdx)
      const kesulitan = baseKey.slice(lastIdx + 1)

      const matching = soalList.filter(s =>
        s &&
        s.bab_id_text === bab.bab_id_text &&
        s.tipe === tipe &&
        s.tingkat_kesulitan === kesulitan
      )

      const approved = matching.filter(s => s.status === 'approved')
      const source = approved.length > 0 ? approved : matching
      const shuffled = [...source].sort(() => Math.random() - 0.5)
      result.push(...shuffled.slice(0, target))
    }
  }

  return result
}

export async function generateGoogleFormsScript(soalList: SoalDownload[], formTitle: string): Promise<void> {
  const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

  const TIPE_ORDER: Record<string, number> = {
    pilgan: 1,
    ceklist: 2,
    isian_singkat: 3,
    benar_salah: 4,
    essay: 5,
  }

  // Konversi gambar ke base64 di browser agar Apps Script tidak perlu fetch network
  const soalData = await Promise.all(
    soalList.filter(Boolean).map(async (s) => {
      const imageUrls = extractImages(s.pertanyaan)
      const imagesBase64 = (
        await Promise.all(
          imageUrls.map(async (url) => {
            const dataUrl = await convertImageToJpegDataUrl(url)
            if (!dataUrl) return null
            // "data:image/jpeg;base64,xxxx"
            const parts = dataUrl.split(',')
            const mimeMatch = parts[0]?.match(/data:(.*);base64/)
            return {
              mime: mimeMatch ? mimeMatch[1] : 'image/jpeg',
              data: parts[1] ?? '',
            }
          })
        )
      ).filter((img): img is { mime: string; data: string } => img !== null)

      return {
        pertanyaan: htmlToPlainText(s.pertanyaan),
        pertanyaan_images: imagesBase64,
        tipe: s.tipe,
        poin: Math.max(1, Math.round(s.bobot)),
        pilihan: (s.pilihan ?? []).map((p, i) => ({
          teks: htmlToPlainText(p.teks),
          benar: p.benar,
          gambar_url: s.pilihan_gambar?.[i] ?? null,
        })),
      }
    })
  )

  soalData.sort((a, b) => (TIPE_ORDER[a.tipe] ?? 99) - (TIPE_ORDER[b.tipe] ?? 99))

  const totalGambar = soalData.reduce((sum, s) => sum + s.pertanyaan_images.length, 0)
  const script = `/**
 * Script Ekspor Soal ke Google Forms
 * Judul : ${formTitle}
 * Dibuat: ${tanggal}
 * Soal  : ${soalData.length} soal
 * Gambar: ${totalGambar} (embedded base64)
 *
 * CARA PAKAI:
 * 1. Buka https://script.google.com > Proyek Baru
 * 2. Hapus kode bawaan, paste seluruh isi file ini
 * 3. Pilih fungsi "createPsatForm" di dropdown atas
 * 4. Klik tombol Run (▶)
 * 5. Izinkan akses saat popup muncul (pilih akun Google kamu)
 * 6. Setelah selesai: klik "View" > "Logs" untuk melihat link form
 */

function createPsatForm() {
  var judulForm = ${JSON.stringify(formTitle)};
  var soalData = ${JSON.stringify(soalData)};

  var form = FormApp.create(judulForm);
  form.setIsQuiz(true);
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);

  soalData.forEach(function(soal) {
    // Sisipkan gambar pertanyaan sebagai ImageItem sebelum soal
    if (soal.pertanyaan_images && soal.pertanyaan_images.length > 0) {
      soal.pertanyaan_images.forEach(function(img, idx) {
        try {
          var decoded = Utilities.base64Decode(img.data);
          var blob = Utilities.newBlob(decoded, img.mime, 'gambar_' + idx);
          form.addImageItem().setImage(blob);
        } catch(e) {
          console.error('Gagal decode gambar ke-' + idx + ': ' + e.message);
        }
      });
    }

    if (soal.tipe === 'pilgan') {
      var pilganItem = form.addMultipleChoiceItem();
      pilganItem.setTitle(soal.pertanyaan);
      pilganItem.setRequired(true);
      pilganItem.setPoints(soal.poin);
      var pilganChoices = [];
      var pilganSeen = {};
      soal.pilihan.forEach(function(p) {
        var teks = p.teks + (p.gambar_url ? '\\n[Gambar: ' + p.gambar_url + ']' : '');
        if (!pilganSeen[teks]) {
          pilganSeen[teks] = true;
          pilganChoices.push(pilganItem.createChoice(teks, p.benar));
        }
      });
      pilganItem.setChoices(pilganChoices);
    } else if (soal.tipe === 'ceklist') {
      var ceklistItem = form.addCheckboxItem();
      ceklistItem.setTitle(soal.pertanyaan);
      ceklistItem.setRequired(true);
      ceklistItem.setPoints(soal.poin);
      var ceklistChoices = [];
      var ceklistSeen = {};
      soal.pilihan.forEach(function(p) {
        var teks = p.teks + (p.gambar_url ? '\\n[Gambar: ' + p.gambar_url + ']' : '');
        if (!ceklistSeen[teks]) {
          ceklistSeen[teks] = true;
          ceklistChoices.push(ceklistItem.createChoice(teks, p.benar));
        }
      });
      ceklistItem.setChoices(ceklistChoices);
    } else if (soal.tipe === 'essay') {
      form.addParagraphTextItem().setTitle(soal.pertanyaan);
    } else {
      form.addTextItem().setTitle(soal.pertanyaan);
    }
  });

  var linkSiswa = form.getPublishedUrl();
  var linkEdit  = form.getEditUrl();

  console.log('=== FORM BERHASIL DIBUAT ===');
  console.log('Judul      : ' + judulForm);
  console.log('Jumlah soal: ' + soalData.length);
  console.log('Link siswa : ' + linkSiswa);
  console.log('Link edit  : ' + linkEdit);
}
`

  const blob = new Blob([script], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${formTitle.replace(/[^a-zA-Z0-9\-_]/g, '_')}_gform.gs`
  a.click()
  URL.revokeObjectURL(url)
}

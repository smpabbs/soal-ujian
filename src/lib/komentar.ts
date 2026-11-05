import { supabase } from "@/lib/supabase"

/**
 * Akses & komentar — satu pintu untuk guru pengampu mapel.
 *
 * Guru yang tidak ditunjuk menulis soal tetap boleh masuk PSAT untuk membaca
 * dan mengomentari soal pada mapel yang ia ampu. Semua gerbangnya ada di
 * database (migrasi 20261104000001): berkas ini hanya membungkus RPC-nya
 * supaya halaman tidak perlu tahu nama parameter atau bentuk balasannya.
 */

/** Hasil `psat.akses_saya()` — nol baris berarti tidak berhak masuk sama sekali. */
export interface AksesSaya {
  id: string
  nama: string | null
  email: string | null
  role: "admin" | "validator" | "guru"
  bisa_menulis: boolean
  bisa_memvalidasi: boolean
  bisa_mengomentari: boolean
  mapel_ids: string[]
  mapel_nama: string[]
  unit_sekolah: string | null
  no_hp: string | null
}

/** Satu soal seperti yang dikirim `psat.get_soal_komentator()`. */
export interface SoalKomentator {
  id: string
  mapel_id: string
  mapel_nama: string
  ujian_id: string | null
  ujian_nama: string | null
  penulis_id: string
  penulis_nama: string
  bab_id_text: string | null
  tipe: string
  tingkat_kesulitan: string
  status: "draft" | "submitted" | "approved" | "needs_revision"
  bobot: number | null
  pertanyaan: string
  gambar_url: string | null
  pilihan: { id: number; teks: string; benar?: boolean }[] | null
  pilihan_gambar: string[] | null
  jawaban_benar: unknown
  rubrik: { kriteria: string; poin: number }[] | null
  created_at: string
  jumlah_komentar: number
  milik_saya: boolean
}

/** Satu baris utas komentar dari `psat.get_komentar_soal()`. */
export interface KomentarSoal {
  id: string
  parent_id: string | null
  penulis_id: string
  nama: string
  peran: string
  isi: string
  created_at: string
  milik_saya: boolean
  boleh_hapus: boolean
}

/** Pesan galat PostgREST → kalimat yang bisa dibaca guru. */
export function pesanKomentar(e: unknown): string {
  const raw = (e as { message?: string })?.message || ""
  if (!raw) return "Terjadi kesalahan. Coba lagi."
  if (raw.includes("Tidak terautentikasi") || raw.includes("JWT")) {
    return "Sesi Anda berakhir. Masuk ulang lalu coba lagi."
  }
  if (raw.includes("tidak mengampu") || raw.includes("tidak berhak")) {
    return "Anda hanya bisa mengomentari soal pada mata pelajaran yang Anda ampu."
  }
  if (raw.includes("satu tingkat")) {
    return "Balasan hanya boleh satu tingkat."
  }
  if (raw.includes("terlalu panjang")) {
    return "Komentar terlalu panjang (maksimal 2000 karakter)."
  }
  if (raw.includes("tidak boleh kosong")) {
    return "Komentar tidak boleh kosong."
  }
  return raw
}

export async function ambilAksesSaya(): Promise<AksesSaya | null> {
  const { data, error } = await supabase.rpc("akses_saya")
  if (error) throw error
  const rows = (data as AksesSaya[]) ?? []
  return rows[0] ?? null
}

export async function ambilSoalKomentator(mapelId: string): Promise<SoalKomentator[]> {
  const { data, error } = await supabase.rpc("get_soal_komentator", { p_mapel_id: mapelId })
  if (error) throw error
  return (data as SoalKomentator[]) ?? []
}

export async function ambilKomentarSoal(soalId: string): Promise<KomentarSoal[]> {
  const { data, error } = await supabase.rpc("get_komentar_soal", { p_soal_id: soalId })
  if (error) throw error
  return (data as KomentarSoal[]) ?? []
}

export async function kirimKomentar(
  soalId: string,
  isi: string,
  parentId: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc("tambah_komentar", {
    p_soal_id: soalId,
    p_isi: isi,
    p_parent_id: parentId,
  })
  if (error) throw error
}

export async function hapusKomentar(id: string): Promise<void> {
  const { error } = await supabase.rpc("hapus_komentar", { p_id: id })
  if (error) throw error
}

/**
 * Jumlah komentar per soal untuk lencana di halaman Soal penulis.
 * Soal tanpa komentar tidak muncul di hasil — pemanggil memakai `?? 0`.
 */
export async function ambilJumlahKomentar(soalIds: string[]): Promise<Record<string, number>> {
  if (soalIds.length === 0) return {}
  const { data, error } = await supabase.rpc("get_jumlah_komentar", { p_soal_ids: soalIds })
  if (error) throw error
  const hasil: Record<string, number> = {}
  ;((data as { soal_id: string; jumlah: number }[]) ?? []).forEach(r => {
    hasil[r.soal_id] = Number(r.jumlah) || 0
  })
  return hasil
}

/**
 * Kelompokkan utas: komentar utama berurutan, balasan menempel di induknya.
 * Balasan yang induknya hilang (seharusnya tidak terjadi karena CASCADE)
 * ditampilkan sebagai komentar utama supaya tidak lenyap diam-diam.
 */
export function susunUtas(rows: KomentarSoal[]): { induk: KomentarSoal; balasan: KomentarSoal[] }[] {
  const utama = rows.filter(r => !r.parent_id)
  const anak = new Map<string, KomentarSoal[]>()
  for (const r of rows) {
    if (!r.parent_id) continue
    const daftar = anak.get(r.parent_id) ?? []
    daftar.push(r)
    anak.set(r.parent_id, daftar)
  }
  const hasil = utama.map(induk => ({ induk, balasan: anak.get(induk.id) ?? [] }))
  const idUtama = new Set(utama.map(u => u.id))
  rows.forEach(r => {
    if (r.parent_id && !idUtama.has(r.parent_id)) hasil.push({ induk: r, balasan: [] })
  })
  return hasil
}

/** Tanggal ringkas ala Indonesia: "4 Nov 2026, 14.05". */
export function waktuSingkat(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const tanggal = d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
  const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
  return `${tanggal}, ${jam}`
}

"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Search, Check, X, Loader2, ChevronDown } from "lucide-react"
import { cariCalonPenulis, pesanError, type CalonPenulis } from "@/lib/ujian"

/** Jeda ketik sebelum pencarian dikirim. */
const DEBOUNCE_MS = 200
/** Di bawah ini tidak dicari: satu huruf atas ~200 guru bukan jawaban apa pun. */
const MIN_HURUF = 2
/** Sama dengan batas RPC. Populasi guru 200, jadi praktis tidak pernah kena. */
const BATAS_CARI = 200

/** Lebar & tinggi maksimum panel dropdown. */
const PANEL_WIDTH = 280
const PANEL_MAX_HEIGHT = 320
/** Jarak panel dari tombol pemicu. */
const PANEL_GAP = 4
/** Perkiraan tinggi bilah pencarian agar daftar tidak terpotong panel. */
const TINGGI_CARI = 38

interface PosisiPanel {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

interface Props {
  ujianId: string
  /** Isi awal dropdown: pengampu mapel+tingkat ujian ini, sudah dimuat halaman. */
  calonAwal: CalonPenulis[]
  disabled?: boolean
  /**
   * Menerima baris utuh, bukan sekadar id: orang yang ditemukan lewat pencarian
   * belum tentu ada di `calonAwal`, jadi halaman harus bisa menyisipkannya —
   * kalau tidak, tombol kembali berbunyi "belum ditunjuk" padahal sudah.
   */
  onPilih: (calon: CalonPenulis | null) => void | Promise<void>
}

/**
 * Pemilih penulis matriks: daftarnya SELURUH guru aktif, dicari lewat ketikan.
 *
 * Dulu ini `<select>` berisi pengampu mapel+tingkat saja. Data `guru_mengajar`
 * di produksi belum lengkap, jadi guru yang sebenarnya ditugasi sering tidak
 * ada di daftar dan tidak ada layar lain untuk menunjuknya.
 *
 * Dua hal yang menahan permintaan supaya tidak satu per huruf:
 *   1. Dropdown dibuka → yang tampil `calonAwal`, tanpa permintaan sama sekali.
 *   2. Mengetik → satu permintaan setelah diam DEBOUNCE_MS, bukan per ketukan.
 *
 * Balasan basi juga dibuang: urutan balasan tidak dijamin, jadi tanpa penjaga
 * hasil "Bu" bisa tiba SESUDAH hasil "Budi" dan menimpanya.
 */
export default function PilihPenulis({ ujianId, calonAwal, disabled, onPilih }: Props) {
  const [buka, setBuka] = useState(false)
  const [q, setQ] = useState("")
  const [hasil, setHasil] = useState<CalonPenulis[] | null>(null)
  const [mencari, setMencari] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  const wadahRef = useRef<HTMLDivElement>(null)
  const tombolRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Nomor permintaan terakhir yang dikirim — balasan lain diabaikan. */
  const seqRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Koordinat panel (position: fixed). Dirender lewat portal agar tidak
   *  terpotong `overflow: hidden` pembungkus tabel maupun `overflow-x-auto`
   *  halaman — dulu dropdown ujian paling bawah hilang di balik tepi tabel. */
  const [posisi, setPosisi] = useState<PosisiPanel | null>(null)

  const terpilih = useMemo(() => calonAwal.find(c => c.ditunjuk), [calonAwal])
  const sedangMencari = q.trim().length >= MIN_HURUF

  /**
   * Tempatkan panel di bawah tombol; bila sisa ruang di bawah tidak cukup
   * (ujian paling bawah), balik ke atas tombol. Tinggi panel ikut ruang yang
   * ada supaya daftar tetap bisa digulir, bukan keluar layar.
   */
  const hitungPosisi = useCallback(() => {
    const tombol = tombolRef.current
    if (!tombol) return
    const rect = tombol.getBoundingClientRect()
    const lebar = Math.min(PANEL_WIDTH, window.innerWidth - 16)
    const kiri = Math.min(Math.max(rect.left, 8), Math.max(8, window.innerWidth - lebar - 8))

    const ruangBawah = window.innerHeight - rect.bottom - PANEL_GAP - 8
    const ruangAtas = rect.top - PANEL_GAP - 8
    const keAtas = ruangBawah < 200 && ruangAtas > ruangBawah
    const tersedia = Math.max(140, keAtas ? ruangAtas : ruangBawah)

    setPosisi(keAtas
      ? { left: kiri, width: lebar, bottom: window.innerHeight - rect.top + PANEL_GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, tersedia) }
      : { left: kiri, width: lebar, top: rect.bottom + PANEL_GAP, maxHeight: Math.min(PANEL_MAX_HEIGHT, tersedia) })
  }, [])

  const bukaPanel = () => {
    if (buka) { setBuka(false); return }
    hitungPosisi()
    setBuka(true)
  }

  /**
   * Jeda ketik dipasang di handler, bukan di useEffect.
   *
   * Versi effect memanggil setState di badannya — React menandainya sebagai
   * cascading render, dan lint project menolaknya. Di handler, tiap ketukan
   * membatalkan timer sebelumnya, jadi permintaan tetap satu per jeda diam.
   */
  const ubahKueri = useCallback((nilai: string) => {
    setQ(nilai)
    if (timerRef.current) clearTimeout(timerRef.current)

    const kueri = nilai.trim()
    if (kueri.length < MIN_HURUF) {
      // Kembali ke daftar awal tanpa menembakkan apa pun. seq dinaikkan supaya
      // balasan yang masih di jalan tidak mendarat di layar yang sudah kosong.
      seqRef.current += 1
      setHasil(null)
      setMencari(false)
      setGalat(null)
      return
    }

    const seq = ++seqRef.current
    setMencari(true)
    timerRef.current = setTimeout(async () => {
      try {
        const r = await cariCalonPenulis(ujianId, kueri, BATAS_CARI)
        if (seqRef.current !== seq) return
        setHasil(r)
        setGalat(null)
      } catch (e) {
        if (seqRef.current !== seq) return
        setHasil([])
        setGalat(pesanError(e))
      } finally {
        if (seqRef.current === seq) setMencari(false)
      }
    }, DEBOUNCE_MS)
  }, [ujianId])

  // Timer yang masih menyala saat komponen dilepas akan memanggil setState pada
  // komponen yang sudah tidak ada. 33 ujian × satu pemilih; tanpa ini, berpindah
  // halaman di tengah ketikan meninggalkan peringatan di konsol.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // ── Tutup saat klik di luar / Escape ──────────────────────────────────────
  useEffect(() => {
    if (!buka) return
    const diLuar = (e: MouseEvent) => {
      const target = e.target as Node
      // Panel dirender lewat portal, jadi bukan keturunan `wadahRef`.
      if (wadahRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setBuka(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setBuka(false) }
    document.addEventListener("mousedown", diLuar)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", diLuar)
      document.removeEventListener("keydown", esc)
    }
  }, [buka])

  // Panel fixed harus ikut bergerak saat halaman/tabel digulir atau jendela
  // diubah ukurannya; kalau tidak, ia tertinggal di koordinat lama.
  useEffect(() => {
    if (!buka) return
    hitungPosisi()
    const perbarui = (e: Event) => {
      // Menggulir daftar di dalam panel bukan alasan menghitung ulang.
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return
      hitungPosisi()
    }
    window.addEventListener("resize", perbarui)
    window.addEventListener("scroll", perbarui, true)
    return () => {
      window.removeEventListener("resize", perbarui)
      window.removeEventListener("scroll", perbarui, true)
    }
  }, [buka, hitungPosisi])

  useEffect(() => { if (buka) inputRef.current?.focus() }, [buka])

  const pilih = useCallback(async (calon: CalonPenulis | null) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    seqRef.current += 1
    setBuka(false)
    setQ("")
    setHasil(null)
    setMencari(false)
    await onPilih(calon)
  }, [onPilih])

  const daftar = hasil ?? calonAwal

  const gaya = {
    border: "1px solid var(--pp-ink)",
    borderRadius: 10,
    backgroundColor: "var(--pp-card)",
    color: "var(--pp-ink)",
  } as const

  return (
    <div ref={wadahRef} className="relative w-full max-w-[240px]">
      <button
        ref={tombolRef}
        type="button"
        disabled={disabled}
        onClick={bukaPanel}
        className="text-xs px-2 py-1 w-full flex items-center gap-1 text-left disabled:opacity-50"
        style={gaya}
      >
        <span className="flex-1 truncate">
          {terpilih
            ? (terpilih.nama || terpilih.profile_id.slice(0, 8))
            : <span style={{ color: "var(--pp-muted)" }}>— belum ditunjuk —</span>}
        </span>
        {disabled
          ? <Loader2 size={12} className="animate-spin shrink-0" />
          : <ChevronDown size={12} className="shrink-0" style={{ color: "var(--pp-muted)" }} />}
      </button>

      {/* Guru yang ditunjuk tapi tidak tercatat mengampu tetap sah — tapi kalau
          tidak dikatakan, ia terlihat seperti salah pilih. */}
      {terpilih && !terpilih.mengampu && (
        <div className="text-[10px] mt-0.5 leading-tight" style={{ color: "var(--pp-muted)" }}>
          Tidak tercatat mengampu mapel ini — tugasnya tetap masuk karena ditunjuk.
        </div>
      )}

      {buka && posisi && createPortal(
        <div
          ref={panelRef}
          className="fixed z-50 shadow-lg overflow-hidden"
          style={{
            ...gaya,
            borderRadius: 12,
            left: posisi.left,
            width: posisi.width,
            top: posisi.top,
            bottom: posisi.bottom,
            maxHeight: posisi.maxHeight,
          }}
        >
          <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: "1px solid var(--pp-line)" }}>
            <Search size={13} className="shrink-0" style={{ color: "var(--pp-muted)" }} />
            <input
              ref={inputRef}
              value={q}
              onChange={e => ubahKueri(e.target.value)}
              placeholder="Cari nama guru…"
              className="text-xs flex-1 bg-transparent outline-none"
              style={{ color: "var(--pp-ink)" }}
            />
            {mencari && <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "var(--pp-muted)" }} />}
            {q && !mencari && (
              <button type="button" onClick={() => ubahKueri("")} aria-label="Kosongkan pencarian">
                <X size={12} style={{ color: "var(--pp-muted)" }} />
              </button>
            )}
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: Math.max(80, posisi.maxHeight - TINGGI_CARI) }}>
            <button
              type="button"
              onClick={() => void pilih(null)}
              className="w-full text-left text-xs px-2 py-1.5 hover:opacity-70"
              style={{ color: "var(--pp-muted)", borderBottom: "1px solid var(--pp-line)" }}
            >
              — lepas penunjukan —
            </button>

            {galat && (
              <div className="text-[11px] px-2 py-2" style={{ color: "#b45309" }}>
                Gagal mencari: {galat}
              </div>
            )}

            {!galat && daftar.length === 0 && (
              <div className="text-[11px] px-2 py-2" style={{ color: "var(--pp-muted)" }}>
                {sedangMencari
                  ? "Tidak ada guru aktif yang cocok. Akun tidak aktif sengaja tidak ditampilkan."
                  : "Belum ada guru tercatat mengampu mapel + tingkat ini — ketik nama untuk mencari guru mana pun."}
              </div>
            )}

            {daftar.map(c => (
              <button
                key={c.profile_id}
                type="button"
                onClick={() => void pilih(c)}
                className="w-full text-left px-2 py-1.5 hover:opacity-70 flex items-start gap-1.5"
                style={{
                  borderBottom: "1px solid var(--pp-line)",
                  opacity: c.status === "aktif" ? 1 : 0.6,
                }}
              >
                <span className="w-3 shrink-0 pt-0.5">
                  {c.ditunjuk && <Check size={12} style={{ color: "var(--pp-primary)" }} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-xs block truncate" style={{ color: "var(--pp-ink)" }}>
                    {c.nama || c.profile_id.slice(0, 8)}
                  </span>
                  {/* Nama saja tidak cukup memilih: satu ujian punya 7–11 calon
                      dari 10 unit. Sekolah dan jumlah kelas yang diampu memberi
                      dasar untuk memutuskan. */}
                  <span className="text-[10px] block truncate" style={{ color: "var(--pp-muted)" }}>
                    {c.sekolah || "tanpa unit"}
                    {c.mengampu ? ` • ${c.jml_kelas} kelas` : " • bukan pengampu"}
                    {c.sudah_isi ? " • sudah mengisi" : ""}
                  </span>
                  {/* Dulu akun begini disaring diam-diam, jadi "kok namanya tidak
                      ada" tak punya jawaban di layar. Sekarang muncul dengan
                      sebabnya — tetapkan_penulis tetap menolaknya. */}
                  {c.status !== "aktif" && (
                    <span className="text-[10px] block" style={{ color: "#b45309" }}>
                      akun {c.status} — aktifkan dulu di LMS sebelum bisa ditunjuk
                    </span>
                  )}
                </span>
              </button>
            ))}

            {!sedangMencari && q.length > 0 && (
              <div className="text-[10px] px-2 py-1.5" style={{ color: "var(--pp-muted)" }}>
                Ketik minimal {MIN_HURUF} huruf untuk mencari seluruh guru.
              </div>
            )}

            {/* Hasil yang menyentuh batas berarti ada nama yang tidak tampil.
                Batas lama (30) memotong diam-diam, dan itulah yang membuat
                pencarian terasa "belum semua guru". */}
            {sedangMencari && !galat && daftar.length > 0 && (
              <div className="text-[10px] px-2 py-1.5" style={{ color: "var(--pp-muted)" }}>
                {daftar.length} guru cocok
                {daftar.length >= BATAS_CARI && " — masih ada yang terpotong, ketik lebih spesifik"}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

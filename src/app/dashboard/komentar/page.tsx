"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, MessageSquare, Send, Trash2, ChevronDown, ChevronUp,
  Search, AlertCircle, Lock, Check,
} from "lucide-react"
import ThemeToggle from "@/components/ThemeToggle"
import SoalKartu, { type SoalPratinjau } from "@/components/SoalKartu"
import { supabase } from "@/lib/supabase"
import {
  ambilAksesSaya, ambilSoalKomentator, ambilKomentarSoal, kirimKomentar,
  hapusKomentar, susunUtas, waktuSingkat, pesanKomentar,
  type AksesSaya, type SoalKomentator, type KomentarSoal,
} from "@/lib/komentar"

/**
 * Layar komentar guru pengampu mapel.
 *
 * Guru yang tidak ditunjuk menulis soal tetap bisa masuk PSAT untuk membaca dan
 * mengomentari soal pada mapel yang ia ampu. Batas mapel bukan sekadar saringan
 * tampilan: RPC get_soal_komentator, get_komentar_soal, dan tambah_komentar
 * semuanya menolak mapel di luar penugasan (migrasi 20261104000001).
 *
 * Soal yang ditampilkan mencakup SEMUA status — draft, submitted, approved,
 * needs_revision. Draft dibuka dengan sengaja: masukan paling berguna datang
 * sebelum soal dikunci, dan approved butuh jalur koreksi karena tidak bisa
 * diedit lagi.
 */

const TIPE_LABELS: Record<string, string> = {
  pilgan: "Pilgan",
  ceklist: "Ceklist",
  essay: "Essay",
  isian_singkat: "Isian Singkat",
  benar_salah: "Benar/Salah",
  pilgan_kategori: "Pilgan Berkategori",
}

const STATUS_LABELS: Record<string, { label: string; bg: string }> = {
  draft:          { label: "Draft",    bg: "var(--pp-bg)" },
  submitted:      { label: "Dikirim",  bg: "var(--pp-lemon)" },
  approved:       { label: "Approved", bg: "var(--pp-mint)" },
  needs_revision: { label: "Revisi",   bg: "var(--pp-pink)" },
}

const BATAS_KOMENTAR = 2000

export default function KomentarPage() {
  const router = useRouter()

  const [akses, setAkses]           = useState<AksesSaya | null>(null)
  const [memuat, setMemuat]         = useState(true)
  const [soal, setSoal]             = useState<SoalKomentator[]>([])
  const [mapelAktif, setMapelAktif] = useState<string>("")
  const [memuatSoal, setMemuatSoal] = useState(false)
  const [galat, setGalat]           = useState("")

  /* ── Utas komentar per soal ── */
  const [utas, setUtas]             = useState<Record<string, KomentarSoal[]>>({})
  const [memuatUtas, setMemuatUtas] = useState<string | null>(null)
  const [draf, setDraf]             = useState<Record<string, string>>({})
  const [balasKe, setBalasKe]       = useState<Record<string, string | null>>({})
  const [mengirim, setMengirim]     = useState<string | null>(null)
  const [galatUtas, setGalatUtas]   = useState<Record<string, string>>({})

  /* ── Saringan daftar ── */
  const [cari, setCari]             = useState("")
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [hanyaBerkomentar, setHanyaBerkomentar] = useState(false)

  useEffect(() => {
    async function muat() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      try {
        const a = await ambilAksesSaya()
        if (!a) { router.replace("/dashboard"); return }
        setAkses(a)
        setMapelAktif(a.mapel_ids[0] ?? "")
      } catch (e) {
        setGalat(pesanKomentar(e))
      } finally {
        setMemuat(false)
      }
    }
    muat()
  }, [router])

  const muatSoal = useCallback(async (mapelId: string) => {
    if (!mapelId) { setSoal([]); return }
    setMemuatSoal(true)
    setGalat("")
    try {
      setSoal(await ambilSoalKomentator(mapelId))
    } catch (e) {
      setSoal([])
      setGalat(pesanKomentar(e))
    } finally {
      setMemuatSoal(false)
    }
  }, [])

  useEffect(() => {
    if (akses && mapelAktif) muatSoal(mapelAktif)
  }, [akses, mapelAktif, muatSoal])

  const muatUtas = async (soalId: string): Promise<KomentarSoal[]> => {
    setMemuatUtas(soalId)
    try {
      const rows = await ambilKomentarSoal(soalId)
      setUtas(prev => ({ ...prev, [soalId]: rows }))
      setGalatUtas(prev => ({ ...prev, [soalId]: "" }))
      return rows
    } catch (e) {
      setGalatUtas(prev => ({ ...prev, [soalId]: pesanKomentar(e) }))
      return utas[soalId] ?? []
    } finally {
      setMemuatUtas(null)
    }
  }

  const bukaUtas = (soalId: string) => {
    if (utas[soalId]) {
      // Tutup: buang dari state supaya daftar tetap ringkas.
      setUtas(prev => { const next = { ...prev }; delete next[soalId]; return next })
      return
    }
    muatUtas(soalId)
  }

  const kirim = async (soalId: string, parentId: string | null) => {
    const isi = (draf[`${soalId}:${parentId ?? "utama"}`] ?? "").trim()
    if (!isi) return
    if (isi.length > BATAS_KOMENTAR) {
      setGalatUtas(prev => ({ ...prev, [soalId]: `Komentar maksimal ${BATAS_KOMENTAR} karakter.` }))
      return
    }
    setMengirim(`${soalId}:${parentId ?? "utama"}`)
    try {
      await kirimKomentar(soalId, isi, parentId)
      setDraf(prev => ({ ...prev, [`${soalId}:${parentId ?? "utama"}`]: "" }))
      setBalasKe(prev => ({ ...prev, [soalId]: null }))
      const rows = await muatUtas(soalId)
      setSoal(prev => prev.map(s => s.id === soalId ? { ...s, jumlah_komentar: rows.length } : s))
    } catch (e) {
      setGalatUtas(prev => ({ ...prev, [soalId]: pesanKomentar(e) }))
    } finally {
      setMengirim(null)
    }
  }

  const hapus = async (soalId: string, id: string) => {
    if (!confirm("Hapus komentar ini? Balasannya ikut terhapus.")) return
    try {
      await hapusKomentar(id)
      const rows = await muatUtas(soalId)
      setSoal(prev => prev.map(s => s.id === soalId ? { ...s, jumlah_komentar: rows.length } : s))
    } catch (e) {
      setGalatUtas(prev => ({ ...prev, [soalId]: pesanKomentar(e) }))
    }
  }

  const soalTampil = useMemo(() => {
    const q = cari.trim().toLowerCase()
    return soal
      .filter(s => !filterStatus || s.status === filterStatus)
      .filter(s => !hanyaBerkomentar || Number(s.jumlah_komentar) > 0)
      .filter(s => {
        if (!q) return true
        return (
          s.pertanyaan.toLowerCase().includes(q) ||
          (s.penulis_nama || "").toLowerCase().includes(q) ||
          (s.bab_id_text || "").toLowerCase().includes(q) ||
          (s.ujian_nama || "").toLowerCase().includes(q)
        )
      })
  }, [soal, cari, filterStatus, hanyaBerkomentar])

  if (memuat) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--pp-bg)" }}>
        <div className="font-display text-xl" style={{ color: "var(--pp-ink-2)" }}>Memuat...</div>
      </div>
    )
  }

  const bolehKomentar = !!akses?.bisa_mengomentari
  const daftarMapel = akses?.mapel_ids ?? []

  return (
    <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-10"
              style={{ backgroundColor: "var(--pp-card)", borderBottom: "1.5px solid var(--pp-ink)" }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity shrink-0"
              style={{ color: "var(--pp-ink-2)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <div className="min-w-0">
              <div className="font-display font-semibold text-base leading-tight flex items-center gap-1.5"
                   style={{ color: "var(--pp-ink)" }}>
                <MessageSquare className="w-4 h-4" />
                Komentar Soal
              </div>
              <div className="text-xs leading-tight truncate" style={{ color: "var(--pp-muted)" }}>
                Masukan untuk soal mapel yang Anda ampu
              </div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 pb-16 space-y-4">

        {/* ── Tidak berhak ── */}
        {!bolehKomentar && (
          <div className="rounded-[18px] p-5 text-center"
               style={{ backgroundColor: "var(--pp-card)", border: "1.5px solid var(--pp-ink)" }}>
            <Lock className="w-7 h-7 mx-auto mb-3" style={{ color: "var(--pp-ink)" }} />
            <div className="font-display font-semibold mb-1.5" style={{ color: "var(--pp-ink)" }}>
              Belum ada mata pelajaran yang bisa dikomentari
            </div>
            <p className="text-sm" style={{ color: "var(--pp-muted)" }}>
              Komentar tersedia untuk guru yang mengampu mata pelajaran. Minta admin mengatur
              penugasan mengajar Anda di LMS, lalu masuk lagi.
            </p>
          </div>
        )}

        {bolehKomentar && (
          <>
            {/* ── Pilih mapel ── */}
            <div className="rounded-[18px] p-4"
                 style={{ backgroundColor: "var(--pp-card)", border: "1.5px solid var(--pp-ink)", boxShadow: "4px 4px 0 0 var(--pp-ink)" }}>
              <div className="text-xs font-semibold uppercase mb-2"
                   style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                Mata pelajaran Anda
              </div>
              {daftarMapel.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--pp-muted)" }}>
                  Belum ada soal yang bisa dikomentari. Soal hanya tampil bila ujiannya
                  berada di siklus yang sedang aktif — minta admin memeriksa siklus
                  ujian di LMS lalu masuk lagi.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {daftarMapel.map((id, i) => {
                    const aktif = id === mapelAktif
                    return (
                      <button
                        key={id}
                        onClick={() => setMapelAktif(id)}
                        className="text-sm font-semibold px-3 py-1.5 rounded-full"
                        style={{
                          backgroundColor: aktif ? "var(--pp-primary)" : "var(--pp-bg)",
                          color: aktif ? "white" : "var(--pp-ink)",
                          border: "1.5px solid var(--pp-ink)",
                          boxShadow: aktif ? "2px 2px 0 0 var(--pp-ink)" : "none",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {akses?.mapel_nama[i] ?? "Mapel"}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {galat && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-[14px] text-sm"
                   style={{ backgroundColor: "#FFE4E4", border: "1px solid #FECACA", color: "#B91C1C" }}>
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {galat}
              </div>
            )}

            {/* ── Saringan ── */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                        style={{ color: "var(--pp-muted)" }} />
                <input
                  value={cari}
                  onChange={e => setCari(e.target.value)}
                  placeholder="Cari pertanyaan, penulis, atau bab..."
                  style={{
                    width: "100%", padding: "10px 12px 10px 36px",
                    borderRadius: 12, border: "1.5px solid var(--pp-ink)",
                    backgroundColor: "var(--pp-card)", fontSize: 13,
                    color: "var(--pp-ink)", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                  }}
                />
              </div>
              {(["draft", "submitted", "approved", "needs_revision"] as const).map(st => {
                const aktif = filterStatus === st
                return (
                  <button
                    key={st}
                    onClick={() => setFilterStatus(aktif ? null : st)}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-full"
                    style={{
                      backgroundColor: aktif ? "var(--pp-ink)" : (STATUS_LABELS[st]?.bg ?? "var(--pp-bg)"),
                      color: aktif ? "white" : "var(--pp-ink)",
                      border: "1.5px solid var(--pp-ink)", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {STATUS_LABELS[st]?.label ?? st}
                  </button>
                )
              })}
              <button
                onClick={() => setHanyaBerkomentar(v => !v)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-full flex items-center gap-1"
                style={{
                  backgroundColor: hanyaBerkomentar ? "var(--pp-lemon)" : "var(--pp-card)",
                  color: "var(--pp-ink)",
                  border: "1.5px solid var(--pp-ink)", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {hanyaBerkomentar && <Check className="w-3 h-3" />}
                Sudah dikomentari
              </button>
            </div>

            {/* ── Daftar soal ── */}
            {memuatSoal ? (
              <div className="text-center py-12 text-sm" style={{ color: "var(--pp-muted)" }}>Memuat soal...</div>
            ) : soalTampil.length === 0 ? (
              <div className="text-center py-12 text-sm rounded-[18px]"
                   style={{ backgroundColor: "var(--pp-card)", border: "1.5px dashed var(--pp-line)", color: "var(--pp-muted)" }}>
                {soal.length === 0
                  ? "Belum ada soal pada mata pelajaran ini."
                  : "Tidak ada soal yang cocok dengan saringan."}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs" style={{ color: "var(--pp-muted)" }}>
                  {soalTampil.length} soal{filterStatus || hanyaBerkomentar || cari ? ` dari ${soal.length}` : ""}
                </div>
                {soalTampil.map((s, idx) => {
                  const terbuka = !!utas[s.id]
                  const daftar = utas[s.id] ?? []
                  const utasTersusun = susunUtas(daftar)
                  const kunciUtama = `${s.id}:utama`
                  return (
                    <div key={s.id} className="rounded-[18px] overflow-hidden"
                         style={{ backgroundColor: "var(--pp-card)", border: "1.5px solid var(--pp-ink)", boxShadow: "3px 3px 0 0 var(--pp-ink)" }}>
                      <div className="p-4">
                        <SoalKartu
                          soal={s as SoalPratinjau}
                          nomor={idx + 1}
                          penulis={s.penulis_nama}
                          meta={[s.bab_id_text, s.ujian_nama].filter(Boolean).join(" · ")}
                        />

                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          <button
                            onClick={() => bukaUtas(s.id)}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full"
                            style={{
                              backgroundColor: terbuka ? "var(--pp-ink)" : "var(--pp-bg)",
                              color: terbuka ? "white" : "var(--pp-ink)",
                              border: "1px solid var(--pp-ink)", cursor: "pointer", fontFamily: "inherit",
                            }}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            {Number(s.jumlah_komentar) > 0
                              ? `${s.jumlah_komentar} komentar`
                              : "Beri komentar"}
                            {terbuka ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                          {s.milik_saya && (
                            <span className="text-xs px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: "#ECE4FF", color: "#2E1A6B", border: "1px solid #C9B8FF" }}>
                              Soal Anda
                            </span>
                          )}
                          <span className="text-xs" style={{ color: "var(--pp-muted)" }}>{TIPE_LABELS[s.tipe] ?? s.tipe}</span>
                        </div>
                      </div>

                      {/* ── Utas ── */}
                      {terbuka && (
                        <div style={{ borderTop: "1.5px solid var(--pp-line)", backgroundColor: "var(--pp-bg)" }}>
                          <div className="p-4 space-y-3">
                            {memuatUtas === s.id && daftar.length === 0 && (
                              <div className="text-xs" style={{ color: "var(--pp-muted)" }}>Memuat komentar...</div>
                            )}

                            {galatUtas[s.id] && (
                              <div className="text-xs px-3 py-2 rounded-lg flex items-start gap-1.5"
                                   style={{ backgroundColor: "#FFE4E4", border: "1px solid #FECACA", color: "#B91C1C" }}>
                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                {galatUtas[s.id]}
                              </div>
                            )}

                            {daftar.length === 0 && memuatUtas !== s.id && (
                              <div className="text-xs" style={{ color: "var(--pp-muted)" }}>
                                Belum ada komentar. Mulai dengan satu masukan yang jelas dan spesifik.
                              </div>
                            )}

                            {utasTersusun.map(({ induk, balasan }) => (
                              <div key={induk.id} className="rounded-[14px] p-3"
                                   style={{ backgroundColor: "var(--pp-card)", border: "1px solid var(--pp-line)" }}>
                                <KomentarBaris k={induk} onHapus={() => hapus(s.id, induk.id)} />

                                {balasan.length > 0 && (
                                  <div className="mt-2 pl-3 space-y-2"
                                       style={{ borderLeft: "2px solid var(--pp-line)" }}>
                                    {balasan.map(b => (
                                      <KomentarBaris key={b.id} k={b} onHapus={() => hapus(s.id, b.id)} />
                                    ))}
                                  </div>
                                )}

                                {/* Balasan hanya untuk komentar utama (satu tingkat) */}
                                {balasKe[s.id] === induk.id ? (
                                  <div className="mt-2 space-y-1.5">
                                    <textarea
                                      value={draf[`${s.id}:${induk.id}`] ?? ""}
                                      onChange={e => setDraf(prev => ({ ...prev, [`${s.id}:${induk.id}`]: e.target.value }))}
                                      rows={2}
                                      maxLength={BATAS_KOMENTAR}
                                      placeholder="Tulis balasan..."
                                      style={textareaStyle}
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => kirim(s.id, induk.id)}
                                        disabled={mengirim === `${s.id}:${induk.id}`}
                                        className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1"
                                        style={tombolKirim(mengirim === `${s.id}:${induk.id}`)}
                                      >
                                        <Send className="w-3 h-3" />
                                        {mengirim === `${s.id}:${induk.id}` ? "Mengirim..." : "Kirim balasan"}
                                      </button>
                                      <button
                                        onClick={() => setBalasKe(prev => ({ ...prev, [s.id]: null }))}
                                        className="text-xs px-2 py-1.5"
                                        style={{ color: "var(--pp-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                                      >
                                        Batal
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setBalasKe(prev => ({ ...prev, [s.id]: induk.id }))}
                                    className="text-xs mt-1.5"
                                    style={{ color: "var(--pp-primary)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                                  >
                                    Balas
                                  </button>
                                )}
                              </div>
                            ))}

                            {/* Kotak komentar utama */}
                            <div>
                              <textarea
                                value={draf[kunciUtama] ?? ""}
                                onChange={e => setDraf(prev => ({ ...prev, [kunciUtama]: e.target.value }))}
                                rows={3}
                                maxLength={BATAS_KOMENTAR}
                                placeholder={
                                  s.milik_saya
                                    ? "Tanggapi masukan untuk soal Anda..."
                                    : "Tulis masukan: bagian mana yang perlu diperbaiki, dan mengapa..."
                                }
                                style={textareaStyle}
                              />
                              <div className="flex items-center justify-between mt-1.5 gap-2">
                                <span className="text-xs" style={{ color: "var(--pp-muted)" }}>
                                  {(draf[kunciUtama] ?? "").length}/{BATAS_KOMENTAR}
                                </span>
                                <button
                                  onClick={() => kirim(s.id, null)}
                                  disabled={mengirim === kunciUtama || !(draf[kunciUtama] ?? "").trim()}
                                  className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1"
                                  style={tombolKirim(mengirim === kunciUtama || !(draf[kunciUtama] ?? "").trim())}
                                >
                                  <Send className="w-3 h-3" />
                                  {mengirim === kunciUtama ? "Mengirim..." : "Kirim komentar"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function KomentarBaris({ k, onHapus }: { k: KomentarSoal; onHapus: () => void }) {
  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold" style={{ color: "var(--pp-ink)" }}>{k.nama}</span>
        <span className="px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: "var(--pp-bg)", color: "var(--pp-ink-2)", border: "1px solid var(--pp-line)", fontSize: 10 }}>
          {k.peran}
        </span>
        <span style={{ color: "var(--pp-muted)" }}>{waktuSingkat(k.created_at)}</span>
        {k.boleh_hapus && (
          <button
            onClick={onHapus}
            title="Hapus komentar"
            className="ml-auto hover:opacity-60 transition-opacity"
            style={{ color: "#B91C1C", background: "none", border: "none", cursor: "pointer", padding: 2 }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words" style={{ color: "var(--pp-ink)", lineHeight: 1.55 }}>
        {k.isi}
      </p>
    </div>
  )
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1.5px solid var(--pp-ink)",
  backgroundColor: "var(--pp-card)",
  fontSize: 13,
  color: "var(--pp-ink)",
  outline: "none",
  fontFamily: "inherit",
  resize: "vertical",
  boxSizing: "border-box",
}

const tombolKirim = (nonaktif: boolean): React.CSSProperties => ({
  backgroundColor: nonaktif ? "var(--pp-bg)" : "var(--pp-primary)",
  color: nonaktif ? "var(--pp-muted)" : "white",
  border: "none",
  cursor: nonaktif ? "not-allowed" : "pointer",
  fontFamily: "inherit",
})

"use client"

import { useCallback, useEffect, useState } from "react"
import { MathHtml } from "@/components/MathHtml"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronDown, ChevronUp, Plus, Pencil, Trash2, Check, CircleHelp, Upload, X, AlertCircle, FileJson, Highlighter, MessageSquare, Send } from "lucide-react"
import ThemeToggle from "@/components/ThemeToggle"
import { supabase } from "@/lib/supabase"
import Toast from "@/components/Toast"
import RichTextEditor from "@/components/RichTextEditor"
import ImageUpload from "@/components/ImageUpload"
import DownloadDropdown from "@/components/DownloadDropdown"
import {
  ambilJumlahKomentar, ambilKomentarSoal, kirimKomentar, hapusKomentar,
  susunUtas, waktuSingkat, pesanKomentar, ambilAksesSaya, type KomentarSoal,
} from "@/lib/komentar"
import { sampleSoalByMatrix } from "@/lib/downloadSoal"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"
import { ambilTugasMenulis, labelUjian, pesanError, punyaKunciTeks, pisahKunci, periksaKunciTeks, periksaKunciAlternatif, punyaRubrik, rapikanRubrik, bacaRubrik, totalPoinRubrik, KESULITAN_OPTIONS, KESULITAN_LABELS, KESULITAN_LABELS_PANJANG, type TugasMenulis, type BarisRubrik } from "@/lib/ujian"

/** Ujian yang sedang dikerjakan, dibagi dengan halaman matrix. */
const UJIAN_KEY = "psat_ujian_id"

interface BabMatrix {
  bab_id_text: string
  /**
   * Tautan bab yang bertahan terhadap ganti nama. Dikirim bersama soal supaya
   * impor tidak perlu menebak lewat nama — lihat migrasi 20260904000001 &
   * lms-new 20260904c. bab_id_text tetap dipakai sebagai kunci pengelompokan
   * di layar ini, dan database yang menjaganya tetap cocok.
   */
  bab_id: string | null
  data: Record<string, number>
}

const TIPE_OPTIONS = ["pilgan", "ceklist", "essay", "isian_singkat", "benar_salah", "pilgan_kategori"]

/** Tipe yang punya daftar pilihan jawaban. */
const punyaPilihan = (t: string) =>
  t === "pilgan" || t === "ceklist" || t === "benar_salah" || t === "pilgan_kategori"
/** Tipe dengan tepat SATU jawaban benar (radio, bukan ceklist). */
const satuJawaban = (t: string) => t === "pilgan" || t === "benar_salah"
/** Pilihan tetap untuk benar_salah — guru tidak perlu mengetiknya. */
const PILIHAN_BENAR_SALAH = ["Benar", "Salah"]

const TIPE_LABELS: Record<string, string> = {
  pilgan: "Pilgan",
  ceklist: "Ceklist",
  essay: "Essay",
  isian_singkat: "Isian Singkat",
  benar_salah: "Benar/Salah",
  pilgan_kategori: "Pilgan Berkategori",
}

const TIPE_COLORS: Record<string, { bg: string; accent: string }> = {
  pilgan:        { bg: "#ECE4FF", accent: "#6d28d9" },
  ceklist:       { bg: "#DAF5E7", accent: "#15803d" },
  essay:         { bg: "#FFE3D0", accent: "#c2410c" },
  isian_singkat: { bg: "#FFF5C6", accent: "#92400e" },
  benar_salah:     { bg: "#D8ECFF", accent: "#1d4ed8" },
  pilgan_kategori: { bg: "#FFE0EC", accent: "#be185d" },
}

const KESULITAN_COLORS: Record<string, { bg: string; text: string }> = {
  mudah:  { bg: "#d1fae5", text: "#065f46" },
  sedang: { bg: "#fef9c3", text: "#854d0e" },
  sulit:  { bg: "#fee2e2", text: "#991b1b" },
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:          { bg: "var(--pp-bg)",   text: "var(--pp-muted)", label: "Draft" },
  submitted:      { bg: "var(--pp-lemon)", text: "var(--pp-ink)",   label: "Dikirim" },
  approved:       { bg: "var(--pp-mint)",  text: "var(--pp-ink)",   label: "Approved" },
  needs_revision: { bg: "var(--pp-pink)",  text: "var(--pp-ink)",   label: "Revisi" },
}

const BOBOT_DEFAULT: Record<string, Record<string, number>> = {
  pilgan:        { mudah: 1.0, sedang: 1.5, sulit: 2.0 },
  ceklist:       { mudah: 1.5, sedang: 2.0, sulit: 2.5 },
  essay:         { mudah: 2.0, sedang: 3.0, sulit: 4.0 },
  isian_singkat: { mudah: 1.0, sedang: 1.5, sulit: 2.0 },
  benar_salah:     { mudah: 1.0, sedang: 1.0, sulit: 1.5 },
  pilgan_kategori: { mudah: 3.0, sedang: 4.0, sulit: 5.0 },
}

type BobotConfig = Record<string, number>

interface HighlightItem {
  id: string
  field: string
  text: string
  color: "yellow" | "red"
  note: string
  occurrenceIndex?: number
}

function applyHighlights(html: string, highlights: HighlightItem[], field: string): string {
  const relevant = highlights.filter(h => h.field === field)
  if (!relevant.length) return html
  let result = html
  for (const h of relevant) {
    const escaped = h.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const bg = h.color === "red" ? "#fecaca" : "#fef08a"
    const targetIndex = h.occurrenceIndex ?? 0
    let count = 0
    const parts = result.split(/(<[^>]+>)/)
    result = parts.map(part => {
      if (part.startsWith("<")) return part
      return part.replace(new RegExp(escaped, "g"), match => {
        const isTarget = count === targetIndex
        count++
        return isTarget
          ? `<mark style="background:${bg};border-radius:3px;padding:0 2px;cursor:help" title="${h.note || "Ditandai validator"}">${match}</mark>`
          : match
      })
    }).join("")
  }
  return result
}

export default function SoalPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [matrixData, setMatrixData] = useState<BabMatrix[]>([])
  const [tugasList, setTugasList] = useState<TugasMenulis[]>([])
  const [tugasAktif, setTugasAktif] = useState<TugasMenulis | null>(null)
  const [soalStats, setSoalStats] = useState<Record<string, number>>({})
  const [soalList, setSoalList] = useState<any[]>([])
  const [selectedBab, setSelectedBab] = useState("")
  const [activeBab, setActiveBab] = useState<string | null>(null)
  const [selectedMapelId, setSelectedMapelId] = useState("")
  const [mapelNama, setMapelNama] = useState("")
  const [namaGuru, setNamaGuru] = useState("")
  const [kelasGuru, setKelasGuru] = useState("")
  const [selectedTipe, setSelectedTipe] = useState("pilgan")
  const [selectedKesulitan, setSelectedKesulitan] = useState("mudah")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savePressed, setSavePressed] = useState(false)
  const [kirimPressed, setKirimPressed] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)
  const [expandedBabs, setExpandedBabs] = useState<Set<string>>(new Set())
  const [filterTipe, setFilterTipe] = useState<string | null>(null)
  const [rubrik, setRubrik] = useState<BarisRubrik[]>([])
  const [filterKesulitan, setFilterKesulitan] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)

  const [pertanyaan, setPertanyaan] = useState("")
  const [gambarUrl, setGambarUrl] = useState("")
  const [pilihan, setPilihan] = useState<string[]>(["", "", "", ""])
  const [pilihanGambar, setPilihanGambar] = useState<string[]>(["", "", "", ""])
  const [jawabanBenar, setJawabanBenar] = useState<number>(0)
  const [jawabanBenarCeklist, setJawabanBenarCeklist] = useState<number[]>([])
  /** Kunci isian singkat — satu kata. Disimpan di jawaban_benar (jsonb). */
  const [kunciIsian, setKunciIsian] = useState("")
  /** Pesan galat kunci, hanya setelah ada yang diketik — kotak kosong yang
   *  belum disentuh tidak pantas berwarna merah. */
  const kunciDaftar = pisahKunci(kunciIsian)
  const kunciSalah = kunciIsian.trim() ? periksaKunciAlternatif(kunciDaftar) : null
  const [bobot, setBobot] = useState<number>(1.0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [bobotConfig, setBobotConfig] = useState<BobotConfig>({})

  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchRaw, setBatchRaw] = useState<any[]>([])
  const [batchErrors, setBatchErrors] = useState<string[]>([])
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchPasteText, setBatchPasteText] = useState("")

  /* ── Komentar soal: lencana di daftar + utas di panel ── */
  const [jumlahKomentar, setJumlahKomentar] = useState<Record<string, number>>({})
  /** Soal yang panel komentarnya terbuka; satu per satu supaya layar tidak penuh. */
  const [komentarSoalId, setKomentarSoalId] = useState<string | null>(null)
  const [utasKomentar, setUtasKomentar] = useState<KomentarSoal[]>([])
  const [memuatUtas, setMemuatUtas] = useState(false)
  const [drafKomentar, setDrafKomentar] = useState("")
  const [balasKe, setBalasKe] = useState<string | null>(null)
  const [drafBalasan, setDrafBalasan] = useState("")
  const [mengirimKomentar, setMengirimKomentar] = useState(false)
  const [galatKomentar, setGalatKomentar] = useState("")

  /** Pindah ke satu tugas: muat matrix, bobot, dan soal milik ujian itu. */
  const pilihTugas = async (uid: string, tugas: TugasMenulis) => {
    setTugasAktif(tugas)
    localStorage.setItem(UJIAN_KEY, tugas.ujian_id)
    setKelasGuru(tugas.level ? `Kelas ${tugas.level}` : "")
    setMapelNama(tugas.mapel_nama || tugas.ujian_nama)

    const { data: matrixRows } = await supabase
      .from("psat_matrix_input")
      .select("bab_id_text,bab_id,data")
      .eq("profile_id", uid)
      .eq("ujian_id", tugas.ujian_id)
      .eq("is_submitted", true)

    if (!matrixRows || matrixRows.length === 0) {
      setToast({ message: "Silakan submit matrix terlebih dahulu", type: "error" })
      setTimeout(() => router.push("/dashboard/matrix"), 1500)
      return
    }

    setMatrixData(matrixRows as BabMatrix[])
    setExpandedBabs(new Set(matrixRows.map((r: any) => r.bab_id_text)))

    const firstBab = matrixRows[0].bab_id_text
    setActiveBab(firstBab)
    setSelectedBab(firstBab)

    if (tugas.psat_mapel_id) {
      setSelectedMapelId(tugas.psat_mapel_id)

      const { data: bobotRows } = await supabase
        .from("bobot_config")
        .select("tipe, kesulitan, bobot")
        .eq("mapel_id", tugas.psat_mapel_id)

      const cfg: BobotConfig = {}
      bobotRows?.forEach((r: any) => { cfg[`${r.tipe}_${r.kesulitan}`] = Number(r.bobot) })
      setBobotConfig(cfg)
      setBobot(cfg[`pilgan_mudah`] ?? BOBOT_DEFAULT["pilgan"]?.["mudah"] ?? 1.0)
    }

    await reloadSoal(uid, tugas.ujian_id)
  }

  useEffect(() => {
    async function load() {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) { router.push("/login"); return }
      setUser(u)

      // Gerbang kemampuan, bukan sekadar "sudah login". Guru pengampu yang
      // masuk untuk berkomentar tidak punya jalur menulis; tanpa ini ia
      // ditolak database satu per satu tanpa penjelasan.
      const akses = await ambilAksesSaya().catch(() => null)
      if (!akses?.bisa_menulis) {
        setToast({ message: "Halaman ini untuk penulis soal. Anda bisa memberi komentar lewat menu Komentar.", type: "info" })
        setTimeout(() => router.push("/dashboard"), 1500)
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("nama")
        .eq("id", u.id)
        .maybeSingle()
      if (profile) setNamaGuru(profile.nama || "")

      // Ujian menentukan mapel DAN kelas; keduanya tidak lagi ditebak dari profil
      let tugas: TugasMenulis[] = []
      try {
        tugas = await ambilTugasMenulis()
      } catch (e) {
        setToast({ message: "Gagal memuat tugas menulis: " + pesanError(e), type: "error" })
        setLoading(false)
        return
      }
      setTugasList(tugas)

      if (tugas.length === 0) {
        setToast({ message: "Belum ada tugas menulis untuk Anda", type: "error" })
        setTimeout(() => router.push("/dashboard"), 1500)
        return
      }

      const tersimpan = localStorage.getItem(UJIAN_KEY)
      const aktif = tugas.find(t => t.ujian_id === tersimpan) ?? tugas[0]
      await pilihTugas(u.id, aktif)
      setLoading(false)
    }
    load()
    // pilihTugas sengaja tidak masuk deps: efek ini hanya untuk pemuatan awal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const reloadSoal = async (uid: string, ujianId?: string): Promise<Record<string, number>> => {
    // Tanpa cakupan ujian, soal siklus lama ikut terhitung ke slot siklus ini
    const idUjian = ujianId ?? tugasAktif?.ujian_id
    if (!idUjian) return {}
    const { data } = await supabase
      .from("bank_soal")
      .select("id,pertanyaan,tipe,tingkat_kesulitan,bobot,bab_id_text,created_at,pilihan,pilihan_gambar,status,revision_notes,highlights,gambar_url,jawaban_benar,rubrik")
      .eq("guru_id", uid)
      .eq("ujian_id", idUjian)
      .order("created_at", { ascending: true })

    const stats: Record<string, number> = {}
    if (data) {
      setSoalList(data)
      data.forEach((s: any) => {
        const k = `${s.bab_id_text}_${s.tipe}_${s.tingkat_kesulitan}`
        stats[k] = (stats[k] || 0) + 1
      })
      setSoalStats(stats)

      // Lencana komentar dimuat sekali per daftar. Kegagalan di sini tidak boleh
      // menjatuhkan halaman — soal tetap bisa dibaca dan diedit.
      try {
        setJumlahKomentar(await ambilJumlahKomentar(data.map((s: any) => s.id)))
      } catch (e) {
        console.error("Gagal memuat jumlah komentar:", e)
        setJumlahKomentar({})
      }
    }
    return stats
  }

  const getDefaultBobot = (tipe: string, kesulitan: string) =>
    bobotConfig[`${tipe}_${kesulitan}`] ?? BOBOT_DEFAULT[tipe]?.[kesulitan] ?? 1.0

  const findNextOpenSlot = (
    updatedStats: Record<string, number>,
    currentBab: string, currentTipe: string, currentKesulitan: string
  ): { bab: string; tipe: string; kesulitan: string } | null => {
    // Build ordered list of all slots, starting right after current
    const slots: { bab: string; tipe: string; kesulitan: string }[] = []
    for (const bab of matrixData) {
      for (const tipe of TIPE_OPTIONS) {
        for (const kesulitan of KESULITAN_OPTIONS) {
          const target = bab.data[`${tipe}_${kesulitan}_bank`] || 0
          if (target > 0) slots.push({ bab: bab.bab_id_text, tipe, kesulitan })
        }
      }
    }
    const currentIdx = slots.findIndex(
      s => s.bab === currentBab && s.tipe === currentTipe && s.kesulitan === currentKesulitan
    )
    // Search from next slot wrapping around — skip current and already-full ones
    const ordered = [
      ...slots.slice(currentIdx + 1),
      ...slots.slice(0, currentIdx),
    ]
    for (const slot of ordered) {
      const target = matrixData.find(b => b.bab_id_text === slot.bab)
        ?.data[`${slot.tipe}_${slot.kesulitan}_bank`] || 0
      const count = updatedStats[`${slot.bab}_${slot.tipe}_${slot.kesulitan}`] || 0
      if (count < target) return slot
    }
    return null
  }

  const getSoalCount = (babId: string, tipe: string, kesulitan: string) =>
    soalStats[`${babId}_${tipe}_${kesulitan}`] || 0

  const getTargetBank = (babId: string, tipe: string, kesulitan: string) => {
    const bab = matrixData.find(b => b.bab_id_text === babId)
    return bab?.data[`${tipe}_${kesulitan}_bank`] || 0
  }

  const getBabProgress = (babId: string) => {
    let done = 0, total = 0
    TIPE_OPTIONS.forEach(t => KESULITAN_OPTIONS.forEach(k => {
      const target = getTargetBank(babId, t, k)
      if (target > 0) {
        total += target
        done += Math.min(getSoalCount(babId, t, k), target)
      }
    }))
    return { done, total }
  }

  /**
   * Slot yang belum memenuhi target bank, lengkap dengan kekurangannya.
   *
   * Dulu ini cuma boolean, dan tombol "Kirim ke Validator" mati tanpa satu pun
   * penjelasan slot mana yang kurang — guru hanya melihat tombol abu-abu.
   */
  const slotKurang = (): { bab: string; tipe: string; kesulitan: string; kurang: number }[] => {
    const hasil: { bab: string; tipe: string; kesulitan: string; kurang: number }[] = []
    for (const bab of matrixData) {
      for (const tipe of TIPE_OPTIONS) {
        for (const kesulitan of KESULITAN_OPTIONS) {
          const target = getTargetBank(bab.bab_id_text, tipe, kesulitan)
          const ada = getSoalCount(bab.bab_id_text, tipe, kesulitan)
          if (ada < target) hasil.push({ bab: bab.bab_id_text, tipe, kesulitan, kurang: target - ada })
        }
      }
    }
    return hasil
  }

  const isAllTargetMet = () => matrixData.length > 0 && slotKurang().length === 0

  const totalTarget = matrixData.reduce((sum, bab) =>
    sum + TIPE_OPTIONS.reduce((s2, t) =>
      s2 + KESULITAN_OPTIONS.reduce((s3, k) =>
        s3 + (bab.data[`${t}_${k}_bank`] || 0), 0), 0), 0)

  const totalDibuat = soalList.length

  const resetForm = () => {
    setPertanyaan("")
    setGambarUrl("")
    setPilihan(["", "", "", ""])
    setPilihanGambar(["", "", "", ""])
    setJawabanBenar(0)
    setJawabanBenarCeklist([])
    setKunciIsian("")
    setRubrik([])
    setSelectedTipe("pilgan")
    setSelectedKesulitan("mudah")
    setBobot(getDefaultBobot("pilgan", "mudah"))
    setEditingId(null)
  }

  // Clear form content only — keep current bab, tipe, kesulitan
  const resetFormContent = () => {
    setPertanyaan("")
    setGambarUrl("")
    setPilihan(["", "", "", ""])
    setPilihanGambar(["", "", "", ""])
    setJawabanBenar(0)
    setJawabanBenarCeklist([])
    setKunciIsian("")
    setRubrik([])
    setEditingId(null)
  }

  const toggleBab = (babId: string) => {
    setExpandedBabs(prev => {
      const next = new Set(prev)
      if (next.has(babId)) next.delete(babId)
      else next.add(babId)
      return next
    })
  }

  const selectBab = (babId: string) => {
    setActiveBab(babId)
    setSelectedBab(babId)
    resetForm()
  }

  const openSlot = (babId: string, tipe: string, kesulitan: string) => {
    setActiveBab(babId)
    setSelectedBab(babId)
    setEditingId(null)
    setPertanyaan("")
    setGambarUrl("")
    setPilihan(["", "", "", ""])
    setPilihanGambar(["", "", "", ""])
    setJawabanBenar(0)
    setJawabanBenarCeklist([])
    // Kunci isian dan rubrik ikut dibersihkan: keduanya milik SATU soal, dan
    // membiarkannya membuat isi slot sebelumnya menempel diam-diam ke slot baru.
    setKunciIsian("")
    setRubrik([])
    setSelectedTipe(tipe)
    setSelectedKesulitan(kesulitan)
    setBobot(getDefaultBobot(tipe, kesulitan))
  }

  /**
   * Nama bab → tautan UUID-nya, diambil dari baris matriks yang sedang dipakai.
   *
   * Dikirim bersama soal supaya tautannya tidak bergantung pada nama. Bila
   * baris matriksnya belum punya bab_id (baris warisan sebelum kolom itu ada),
   * kembalikan null dan biarkan impor jatuh ke pencocokan nama seperti dulu —
   * jangan menebak, karena tebakan yang salah menempelkan soal ke bab lain.
   */
  const babIdDari = (nama: string): string | null =>
    matrixData.find(b => b.bab_id_text === nama)?.bab_id ?? null

  const handleSaveSoal = async () => {
    if (!user || !selectedBab || !pertanyaan.trim()) {
      setToast({ message: "Pertanyaan wajib diisi", type: "error" })
      return
    }

    // Kunci isian singkat wajib dan harus satu kata. Diperiksa DI SINI, bukan
    // hanya lewat atribut input: form ini juga bisa disimpan lewat Enter dan
    // lewat jalur edit, dan aturannya harus sama di keduanya.
    if (punyaKunciTeks(selectedTipe)) {
      const salah = periksaKunciTeks(kunciIsian)
      if (salah) { setToast({ message: salah, type: "error" }); return }
    }

    const currentCount = getSoalCount(selectedBab, selectedTipe, selectedKesulitan)
    const targetBank = getTargetBank(selectedBab, selectedTipe, selectedKesulitan)

    if (!editingId && currentCount >= targetBank) {
      setToast({ message: `Bank soal ${selectedBab} — ${TIPE_LABELS[selectedTipe] ?? selectedTipe} ${KESULITAN_LABELS[selectedKesulitan] ?? selectedKesulitan} sudah penuh (${currentCount}/${targetBank})`, type: "error" })
      return
    }

    setSaving(true)

    const pilihanObj = punyaPilihan(selectedTipe)
      ? pilihan.map((p, i) => ({
          id: i,
          teks: p,
          benar: satuJawaban(selectedTipe) ? i === jawabanBenar : jawabanBenarCeklist.includes(i),
        }))
      : null

    let err: any = null

    if (editingId) {
      const { error } = await supabase.from("bank_soal").update({
        pertanyaan,
        tipe: selectedTipe,
        bab_id_text: selectedBab,
        bab_id: babIdDari(selectedBab),
        ujian_id: tugasAktif?.ujian_id ?? null,
        mata_pelajaran_id: selectedMapelId,
        level: selectedKesulitan,
        bobot,
        tingkat_kesulitan: selectedKesulitan,
        pilihan: pilihanObj,
        pilihan_gambar: pilihanGambar,
        // jawaban_benar jsonb menampung DUA bentuk: indeks pilihan (pilgan,
        // benar_salah) atau kata kunci (isian_singkat). Yang membedakan tipenya.
        jawaban_benar: satuJawaban(selectedTipe)
          ? jawabanBenar
          : punyaKunciTeks(selectedTipe)
            ? kunciDaftar
            : null,
        rubrik: punyaRubrik(selectedTipe) ? rapikanRubrik(rubrik) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", editingId)
      err = error
    } else {
      const { error } = await supabase.from("bank_soal").insert({
        pertanyaan,
        tipe: selectedTipe,
        guru_id: user.id,
        bab_id_text: selectedBab,
        bab_id: babIdDari(selectedBab),
        ujian_id: tugasAktif?.ujian_id ?? null,
        mata_pelajaran_id: selectedMapelId,
        level: selectedKesulitan,
        bobot,
        tingkat_kesulitan: selectedKesulitan,
        pilihan: pilihanObj,
        pilihan_gambar: pilihanGambar,
        // jawaban_benar jsonb menampung DUA bentuk: indeks pilihan (pilgan,
        // benar_salah) atau kata kunci (isian_singkat). Yang membedakan tipenya.
        jawaban_benar: satuJawaban(selectedTipe)
          ? jawabanBenar
          : punyaKunciTeks(selectedTipe)
            ? kunciDaftar
            : null,
        rubrik: punyaRubrik(selectedTipe) ? rapikanRubrik(rubrik) : null,
        gambar_url: gambarUrl || null,
      })
      err = error
    }

    setSaving(false)

    if (err) {
      setToast({ message: "Error: " + err.message, type: "error" })
      return
    }

    if (editingId) {
      setToast({ message: "Soal diupdate!", type: "success" })
      resetFormContent()
      await reloadSoal(user.id)
      return
    }

    // New soal: reload then check if slot is now full
    const savedBab = selectedBab
    const savedTipe = selectedTipe
    const savedKesulitan = selectedKesulitan
    const updatedStats = await reloadSoal(user.id)
    const newCount = updatedStats[`${savedBab}_${savedTipe}_${savedKesulitan}`] || 0
    const target = getTargetBank(savedBab, savedTipe, savedKesulitan)

    if (newCount >= target) {
      const next = findNextOpenSlot(updatedStats, savedBab, savedTipe, savedKesulitan)
      if (next) {
        setToast({ message: `Slot penuh! Pindah ke ${TIPE_LABELS[next.tipe]} · ${KESULITAN_LABELS[next.kesulitan] ?? next.kesulitan}`, type: "info" })
        openSlot(next.bab, next.tipe, next.kesulitan)
      } else {
        setToast({ message: "Semua slot terpenuhi!", type: "success" })
        resetFormContent()
      }
    } else {
      // Slot belum penuh — stay di tipe & kesulitan yang sama
      setToast({ message: "Soal disimpan!", type: "success" })
      resetFormContent()
    }
  }

  const handleEditSoal = async (soal: any) => {
    const { data: soalData } = await supabase
      .from("bank_soal")
      .select("*")
      .eq("id", soal.id)
      .single()
    if (!soalData) return

    setSelectedBab(soalData.bab_id_text || "")
    setActiveBab(soalData.bab_id_text || null)
    setSelectedTipe(soalData.tipe)
    setSelectedKesulitan(soalData.tingkat_kesulitan)
    setPertanyaan(soalData.pertanyaan)
    setBobot(soalData.bobot)
    setEditingId(soalData.id)
    setGambarUrl(soalData.gambar_url || "")
    setRubrik(bacaRubrik(soalData.rubrik))

    if (punyaKunciTeks(soalData.tipe)) {
      // Larik adalah bentuk simpanannya; string diterima juga supaya baris yang
      // sempat tersimpan sebelum alternatif ada tetap bisa disunting.
      const jb = soalData.jawaban_benar
      if (Array.isArray(jb)) setKunciIsian(jb.join(", "))
      else if (typeof jb === "string") setKunciIsian(jb)
    }

    if (soalData.pilihan) {
      setPilihan(soalData.pilihan.map((p: any) => p.teks || ""))
      if (satuJawaban(soalData.tipe)) {
        const idx = soalData.pilihan.findIndex((p: any) => p.benar)
        if (idx >= 0) setJawabanBenar(idx)
      } else if (punyaPilihan(soalData.tipe)) {
        setJawabanBenarCeklist(soalData.pilihan.filter((p: any) => p.benar).map((p: any) => p.id))
      }
    }
    setPilihanGambar(Array(4).fill("").map((_: string, i: number) => soalData.pilihan_gambar?.[i] || ""))

    setTimeout(() => {
      document.getElementById("tour-form-soal")?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
  }

  const handleDeleteSoal = async (soalId: string) => {
    if (!confirm("Yakin hapus soal ini?")) return    // .select() wajib. Policy soal_delete_own_draft hanya mengizinkan status
    // 'draft', sedangkan tombol hapus juga aktif untuk soal 'needs_revision' —
    // tanpa pemeriksaan ini soal lenyap dari layar, tidak terhapus di basis
    // data, lalu muncul lagi begitu halaman dimuat ulang.
    const { data: terhapus, error } = await supabase
      .from("bank_soal").delete().eq("id", soalId).select("id")
    if (error) {
      setToast({ message: "Gagal menghapus: " + error.message, type: "error" })
      return
    }
    if (!terhapus || terhapus.length === 0) {
      setToast({ message: "Soal tidak bisa dihapus — hanya soal berstatus Draft yang boleh dihapus.", type: "error" })
      return
    }
    const updated = soalList.filter(s => s.id !== soalId)
    setSoalList(updated)
    const stats: Record<string, number> = {}
    updated.forEach((s: any) => {
      const k = `${s.bab_id_text}_${s.tipe}_${s.tingkat_kesulitan}`
      stats[k] = (stats[k] || 0) + 1
    })
    setSoalStats(stats)
  }

  /* ── Komentar: muat, kirim, balas, hapus ── */

  const bukaKomentar = async (soalId: string) => {
    if (komentarSoalId === soalId) { setKomentarSoalId(null); return }
    setKomentarSoalId(soalId)
    setUtasKomentar([])
    setDrafKomentar("")
    setDrafBalasan("")
    setBalasKe(null)
    setGalatKomentar("")
    setMemuatUtas(true)
    try {
      setUtasKomentar(await ambilKomentarSoal(soalId))
    } catch (e) {
      setGalatKomentar(pesanKomentar(e))
    } finally {
      setMemuatUtas(false)
    }
  }

  const kirimKomentarBaru = async (soalId: string, parentId: string | null) => {
    const isi = (parentId ? drafBalasan : drafKomentar).trim()
    if (!isi) return
    setMengirimKomentar(true)
    setGalatKomentar("")
    try {
      await kirimKomentar(soalId, isi, parentId)
      if (parentId) { setDrafBalasan(""); setBalasKe(null) } else { setDrafKomentar("") }
      const rows = await ambilKomentarSoal(soalId)
      setUtasKomentar(rows)
      setJumlahKomentar(prev => ({ ...prev, [soalId]: rows.length }))
    } catch (e) {
      setGalatKomentar(pesanKomentar(e))
    } finally {
      setMengirimKomentar(false)
    }
  }

  const hapusKomentarSoal = async (soalId: string, id: string) => {
    if (!confirm("Hapus komentar ini? Balasannya ikut terhapus.")) return
    try {
      await hapusKomentar(id)
      const rows = await ambilKomentarSoal(soalId)
      setUtasKomentar(rows)
      setJumlahKomentar(prev => ({ ...prev, [soalId]: rows.length }))
    } catch (e) {
      setGalatKomentar(pesanKomentar(e))
    }
  }

  const handleKirimValidator = async () => {
    if (!user) return
    if (!confirm("Kirim semua soal ke validator? Setelah dikirim, soal tidak bisa diedit.")) return
    setSaving(true)
    // .select() wajib: penolakan RLS mengembalikan 0 baris TANPA galat, jadi
    // "tidak ada error" bukan bukti apa pun terkirim. Tanpa ini layar berkata
    // "berhasil dikirim" untuk pengiriman yang tidak pernah terjadi.
    const { data: terkirim, error } = await supabase
      .from("bank_soal")
      .update({ status: "submitted", updated_at: new Date().toISOString() })
      .eq("guru_id", user.id)
      .eq("ujian_id", tugasAktif?.ujian_id ?? "")
      .in("status", ["draft", "needs_revision"])
      .select("id")
    setSaving(false)
    if (error) {
      setToast({ message: "Error: " + error.message, type: "error" })
    } else if (!terkirim || terkirim.length === 0) {
      setToast({ message: "Tidak ada soal yang terkirim. Muat ulang halaman lalu coba lagi.", type: "error" })
    } else {
      const idTerkirim = new Set(terkirim.map(r => r.id))
      setToast({ message: `${terkirim.length} soal berhasil dikirim ke validator!`, type: "success" })
      // Hanya soal yang BENAR-BENAR berubah yang ditandai. Versi lama menandai
      // seluruh daftar, sehingga soal yang sudah `approved` ikut tampak
      // "Dikirim" sampai halaman dimuat ulang.
      setSoalList(soalList.map(s => (idTerkirim.has(s.id) ? { ...s, status: "submitted" } : s)))

      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session || !selectedMapelId) return
        fetch("/api/notifications/whatsapp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ type: "guru_submit", mapelId: selectedMapelId, guruId: user.id }),
        }).catch(() => {})
      })
    }
  }

  /** Kunci dari JSON impor: terima string ber-koma maupun larik. */
  const kunciDariJson = (nilai: unknown): string[] =>
    Array.isArray(nilai)
      ? pisahKunci(nilai.map(v => String(v)).join(","))
      : pisahKunci(String(nilai ?? ""))

  const validateBatchItem = (item: any, idx: number): string[] => {
    const errs: string[] = []
    if (!item.pertanyaan?.trim()) errs.push(`#${idx + 1}: pertanyaan wajib diisi`)
    if (!TIPE_OPTIONS.includes(item.tipe)) errs.push(`#${idx + 1}: tipe tidak valid — "${item.tipe}" (pilgan/ceklist/essay/isian_singkat/benar_salah/pilgan_kategori)`)
    if (!(KESULITAN_OPTIONS as readonly string[]).includes(item.tingkat_kesulitan)) errs.push(`#${idx + 1}: tingkat_kesulitan tidak valid — "${item.tingkat_kesulitan}" (tulis mudah/sedang/sulit; di layar tampil LOTS/MOTS/HOTS)`)
    const validBabs = matrixData.map(b => b.bab_id_text)
    if (!validBabs.includes(item.bab_id_text)) errs.push(`#${idx + 1}: bab_id_text tidak ditemukan — "${item.bab_id_text}"`)
    if (punyaPilihan(item.tipe) && (!Array.isArray(item.pilihan) || item.pilihan.length < 2))
      errs.push(`#${idx + 1}: pilihan wajib ada minimal 2 item untuk tipe ${item.tipe}`)
    // Impor massal adalah pintu KEDUA ke tabel yang sama. Tanpa pemeriksaan di
    // sini, aturan satu-kata bisa dilewati begitu saja lewat JSON — dan fungsi
    // yang dipanggil sengaja sama persis dengan yang dipakai form.
    if (punyaKunciTeks(item.tipe)) {
      // JSON boleh menulis kunci sebagai string ("kata") atau larik
      // (["kata","alternatif"]) — keduanya diperiksa dengan aturan yang sama.
      const salah = periksaKunciAlternatif(kunciDariJson(item.jawaban_benar))
      if (salah) errs.push(`#${idx + 1}: ${salah.toLowerCase()}`)
    }
    return errs
  }

  const applyBatchJson = (text: string) => {
    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) {
        setBatchErrors(["Harus berupa array JSON (dimulai dengan [ dan diakhiri dengan ])"])
        setBatchRaw([])
        return
      }
      const allErrors: string[] = []
      parsed.forEach((item, i) => allErrors.push(...validateBatchItem(item, i)))
      setBatchRaw(parsed)
      setBatchErrors(allErrors)
    } catch {
      setBatchErrors(["JSON tidak valid — pastikan format JSON sudah benar"])
      setBatchRaw([])
    }
  }

  const handleBatchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setBatchPasteText("")
      applyBatchJson(text)
    }
    reader.readAsText(file)
  }

  const handleBatchPasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setBatchPasteText(text)
    if (!text.trim()) { setBatchRaw([]); setBatchErrors([]); return }
    applyBatchJson(text)
  }

  const handleBatchInsert = async () => {
    if (!user || batchErrors.length > 0 || batchRaw.length === 0) return
    setBatchSaving(true)
    const rows = batchRaw.map((item: any) => {
      const pilihanObj = punyaPilihan(item.tipe) && Array.isArray(item.pilihan)
        ? item.pilihan.map((p: any, i: number) => ({ id: p.id ?? i, teks: p.teks, benar: !!p.benar }))
        : null
      const bobotVal = getDefaultBobot(item.tipe, item.tingkat_kesulitan)
      return {
        pertanyaan: item.pertanyaan.trim(),
        tipe: item.tipe,
        tingkat_kesulitan: item.tingkat_kesulitan,
        level: item.tingkat_kesulitan,
        bab_id_text: item.bab_id_text,
        ujian_id: tugasAktif?.ujian_id ?? null,
        mata_pelajaran_id: selectedMapelId,
        guru_id: user.id,
        bobot: bobotVal,
        pilihan: pilihanObj,
        jawaban_benar: satuJawaban(item.tipe)
          ? (pilihanObj?.findIndex((p: any) => p.benar) ?? null)
          : punyaKunciTeks(item.tipe)
            ? kunciDariJson(item.jawaban_benar)
            : null,
        status: "draft",
      }
    })
    const { error } = await supabase.from("bank_soal").insert(rows)
    setBatchSaving(false)
    if (error) {
      setToast({ message: "Error: " + error.message, type: "error" })
    } else {
      setToast({ message: `${rows.length} soal berhasil diupload sebagai draft!`, type: "success" })
      setShowBatchModal(false)
      setBatchRaw([])
      setBatchErrors([])
      setBatchPasteText("")
      await reloadSoal(user.id)
    }
  }

  const downloadBatchTemplate = () => {
    const babContoh = matrixData[0]?.bab_id_text || "Nama Bab"
    const template = [
      {
        pertanyaan: "Contoh soal pilihan ganda — ganti dengan pertanyaan Anda",
        tipe: "pilgan",
        tingkat_kesulitan: "mudah",
        bab_id_text: babContoh,
        pilihan: [
          { id: 0, teks: "Pilihan A", benar: false },
          { id: 1, teks: "Pilihan B (jawaban benar)", benar: true },
          { id: 2, teks: "Pilihan C", benar: false },
          { id: 3, teks: "Pilihan D", benar: false },
        ],
      },
      {
        pertanyaan: "Contoh soal ceklist — bisa ada lebih dari satu jawaban benar",
        tipe: "ceklist",
        tingkat_kesulitan: "sedang",
        bab_id_text: babContoh,
        pilihan: [
          { id: 0, teks: "Pilihan A (benar)", benar: true },
          { id: 1, teks: "Pilihan B", benar: false },
          { id: 2, teks: "Pilihan C (benar)", benar: true },
          { id: 3, teks: "Pilihan D", benar: false },
        ],
      },
      {
        pertanyaan: "Contoh soal essay",
        tipe: "essay",
        tingkat_kesulitan: "sulit",
        bab_id_text: babContoh,
        pilihan: [],
      },
      {
        pertanyaan: "Contoh soal isian singkat — jawaban_benar wajib SATU KATA",
        tipe: "isian_singkat",
        tingkat_kesulitan: "mudah",
        bab_id_text: babContoh,
        pilihan: [],
        jawaban_benar: ["fotosintesis", "photosynthesis"],
      },
    ]
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "template-soal-batch.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  const startTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      nextBtnText: "Lanjut →",
      prevBtnText: "← Kembali",
      doneBtnText: "Selesai",
      progressText: "{{current}} dari {{total}}",
      steps: [
        {
          element: "#tour-soal-header",
          popover: {
            title: "Input Soal",
            description: "Halaman ini untuk membuat dan mengelola soal ujian. Kamu bisa download soal, kirim ke validator, atau kembali ke dashboard dari header ini.",
            side: "bottom",
          },
        },
        {
          element: "#tour-overall-progress",
          popover: {
            title: "Progress Keseluruhan",
            description: "Menampilkan berapa soal sudah dibuat dari total target semua bab. Progress bar berubah hijau jika semua target terpenuhi.",
            side: "right",
          },
        },
        {
          element: "#tour-bab-nav",
          popover: {
            title: "Navigasi Bab",
            description: "Daftar bab dari matrix yang sudah kamu submit. Klik bab untuk memilih bab aktif. Klik slot (tipe · kesulitan) untuk langsung mengisi form dengan pilihan tersebut.",
            side: "right",
          },
        },
        {
          element: "#tour-form-soal",
          popover: {
            title: "Form Input Soal",
            description: "Form utama untuk membuat soal baru. Pilih bab aktif dari navigasi kiri, lalu isi tipe, kesulitan, dan pertanyaan.",
            side: "left",
          },
        },
        {
          element: "#tour-tipe-kesulitan",
          popover: {
            title: "Tipe & Kesulitan",
            description: "Pilih tipe soal (Pilgan, Ceklist, Essay, Isian Singkat) dan tingkat kesulitan. Bobot soal dihitung otomatis.",
            side: "bottom",
          },
        },
        {
          element: "#tour-editor-pertanyaan",
          popover: {
            title: "Editor Pertanyaan",
            description: "Ketik soal di sini. Toolbar mendukung bold, italic, superscript, subscript, simbol derajat (°), dan pecahan matematika. Gambar juga bisa disisipkan.",
            side: "top",
          },
        },
        {
          element: "#tour-aksi-soal",
          popover: {
            title: "Simpan Soal",
            description: "Klik Simpan untuk menyimpan soal ke database. Jika sedang mengedit soal lama, tombol berubah jadi Update dan muncul tombol Batal Edit.",
            side: "top",
          },
        },
        {
          element: "#tour-soal-list",
          popover: {
            title: "Daftar Soal",
            description: "Soal yang sudah dibuat untuk bab aktif tampil di sini. Klik ikon pensil untuk edit, ikon tong sampah untuk hapus.",
            side: "top",
          },
        },
        {
          element: "#tour-kirim-validator",
          popover: {
            title: "Kirim ke Validator",
            description: "Setelah semua target soal terpenuhi, tombol ini aktif. Klik untuk mengirim soal ke validator untuk direview.",
            side: "bottom",
          },
        },
      ],
    })
    driverObj.drive()
  }, [])

  useEffect(() => {
    if (loading) return
    if (!localStorage.getItem("soal_tour_done")) {
      localStorage.setItem("soal_tour_done", "1")
      setTimeout(() => startTour(), 500)
    }
  }, [loading, startTour])

  useEffect(() => {
    if (loading || soalList.length === 0) return
    const revisiFlag = localStorage.getItem("soal_filter_revisi")
    if (revisiFlag) {
      localStorage.removeItem("soal_filter_revisi")
      setFilterStatus("needs_revision")
      const firstRevisionSoal = soalList.find(s => s.status === "needs_revision")
      if (firstRevisionSoal) setActiveBab(firstRevisionSoal.bab_id_text)
    }
  }, [loading, soalList])

  if (loading) {
    return (
      <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }} className="flex items-center justify-center">
        <div className="font-display text-xl" style={{ color: "var(--pp-ink-2)" }}>Memuat...</div>
      </div>
    )
  }

  const allMet = isAllTargetMet()
  const kurangList = allMet ? [] : slotKurang()
  const progressPct = totalTarget > 0 ? Math.min(100, Math.round((totalDibuat / totalTarget) * 100)) : 0
  const activeBabSoal = activeBab ? soalList.filter(s => s.bab_id_text === activeBab) : []
  const filteredSoal = activeBabSoal
    .filter(s => !filterTipe || s.tipe === filterTipe)
    .filter(s => !filterKesulitan || s.tingkat_kesulitan === filterKesulitan)
    .filter(s => !filterStatus || s.status === filterStatus)
  const matrixSampledSoal = sampleSoalByMatrix(soalList, matrixData)

  const selectStyle: React.CSSProperties = {
    border: "1.5px solid var(--pp-ink)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 14,
    color: "var(--pp-ink)",
    backgroundColor: "var(--pp-card)",
    outline: "none",
    width: "100%",
  }

  return (
    <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }}>
      {/* Header */}
      <header
        id="tour-soal-header"
        className="sticky top-0 z-10"
        style={{ backgroundColor: "var(--pp-card)", borderBottom: "1.5px solid var(--pp-ink)" }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          {/* Brand + title */}
          <div className="flex items-center gap-3 min-w-0">
            <div style={{
              width: 40, height: 40, flexShrink: 0,
              backgroundColor: "var(--pp-primary)",
              border: "1.5px dashed rgba(255,255,255,0.45)",
              borderRadius: 12,
              boxShadow: "2px 2px 0 0 var(--pp-ink)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span className="font-display font-bold text-sm text-white">S</span>
            </div>
            <div className="min-w-0">
              <div className="font-display font-semibold text-base leading-tight" style={{ color: "var(--pp-ink)" }}>
                Input Soal
              </div>
              {tugasAktif && (
                <div className="text-xs leading-tight truncate" style={{ color: "var(--pp-muted)" }}>
                  {labelUjian(tugasAktif)}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <button
              onClick={startTour}
              title="Panduan"
              className="hover:opacity-70 transition-opacity"
              style={{ color: "var(--pp-ink-2)", padding: 6, borderRadius: 8 }}
            >
              <CircleHelp className="w-5 h-5" />
            </button>
            <DownloadDropdown
              soalList={soalList}
              filename={`soal-${mapelNama || "guru"}`}
              meta={{ judul: `Soal ${mapelNama}`, tanggal: new Date().toISOString(), namaGuru: namaGuru || undefined, kelas: kelasGuru || undefined, matrixData: matrixData.length > 0 ? matrixData : undefined }}
              googleFormsSoalList={matrixSampledSoal}
            />
            <button
              onClick={() => { setBatchRaw([]); setBatchErrors([]); setBatchPasteText(""); setShowBatchModal(true) }}
              title="Upload Soal (JSON Batch)"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                border: "1.5px solid var(--pp-ink)",
                borderRadius: 12,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: "var(--pp-card)",
                color: "var(--pp-ink)",
                boxShadow: "2px 2px 0 0 var(--pp-ink)",
                cursor: "pointer",
              }}
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Upload JSON</span>
            </button>
            <button
              id="tour-kirim-validator"
              onClick={allMet ? handleKirimValidator : undefined}
              disabled={saving || !allMet}
              onMouseDown={() => allMet && setKirimPressed(true)}
              onMouseUp={() => setKirimPressed(false)}
              onMouseLeave={() => setKirimPressed(false)}
              style={{
                backgroundColor: allMet ? "var(--pp-mint)" : "var(--pp-bg)",
                color: allMet ? "var(--pp-ink)" : "var(--pp-muted)",
                border: `1.5px solid ${allMet ? "var(--pp-ink)" : "var(--pp-line)"}`,
                borderRadius: 12,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                boxShadow: allMet && !kirimPressed ? "3px 3px 0 0 var(--pp-ink)" : "none",
                transform: kirimPressed ? "translate(2px,2px)" : "none",
                transition: "all 80ms",
                cursor: allMet ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", gap: 6,
              }}
              // Tombol yang mati harus bisa menjelaskan dirinya. Tanpa ini guru
              // hanya melihat tombol abu-abu dan tidak tahu slot mana yang kurang.
              title={
                allMet
                  ? "Kirim seluruh soal ujian ini ke validator"
                  : matrixData.length === 0
                    ? "Matriks belum dimuat."
                    : `Belum bisa dikirim — kurang ${kurangList.reduce((n, k) => n + k.kurang, 0)} soal di ${kurangList.length} slot:\n` +
                      kurangList.slice(0, 12).map(k => `• ${k.bab} · ${TIPE_LABELS[k.tipe] ?? k.tipe} · ${KESULITAN_LABELS[k.kesulitan] ?? k.kesulitan}: kurang ${k.kurang}`).join("\n") +
                      (kurangList.length > 12 ? `\n… dan ${kurangList.length - 12} slot lain` : "")
              }
            >
              {allMet && <Check className="w-3.5 h-3.5" />}
              {saving
                ? "Mengirim..."
                : allMet
                  ? "Kirim ke Validator"
                  : `Kurang ${kurangList.reduce((n, k) => n + k.kurang, 0)} soal`}
            </button>
          </div>
        </div>
      </header>

      {/* Back link */}
      <div className="max-w-7xl mx-auto px-4 pt-4 pb-1">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
          style={{ color: "var(--pp-muted)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Dashboard
        </button>
      </div>

      {/* Pindah antar tugas tanpa memuat ulang halaman */}
      {tugasList.length > 1 && (
        <div className="max-w-7xl mx-auto px-4 pt-2 flex flex-wrap gap-2">
          {tugasList.map(t => {
            const aktif = t.ujian_id === tugasAktif?.ujian_id
            return (
              <button
                key={t.ujian_id}
                onClick={async () => {
                  if (aktif || !user) return
                  setLoading(true)
                  await pilihTugas(user.id, t)
                  setLoading(false)
                }}
                className="text-sm"
                style={{
                  backgroundColor: aktif ? "var(--pp-ink)" : "var(--pp-card)",
                  color: aktif ? "#fff" : "var(--pp-ink)",
                  border: "1.5px solid var(--pp-ink)",
                  borderRadius: 999,
                  padding: "6px 14px",
                  fontWeight: 600,
                  boxShadow: aktif ? "none" : "2px 2px 0 0 var(--pp-ink)",
                  cursor: aktif ? "default" : "pointer",
                }}
              >
                {labelUjian(t)}
              </button>
            )
          })}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-4 pb-12 flex gap-5 items-start">

        {/* ── Left Sidebar ── */}
        <div className="w-64 flex-shrink-0 sticky top-20 space-y-4">

          {/* Overall progress */}
          <div
            id="tour-overall-progress"
            style={{
              backgroundColor: "var(--pp-card)",
              border: "1.5px solid var(--pp-ink)",
              borderRadius: 22,
              boxShadow: "4px 4px 0 0 var(--pp-ink)",
              padding: "16px 20px",
            }}
          >
            <div className="text-xs font-bold uppercase mb-1" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
              Progress
            </div>
            <div className="flex items-baseline gap-1.5 mb-3">
              <span className="font-display font-bold text-3xl" style={{ color: "var(--pp-ink)" }}>{totalDibuat}</span>
              <span className="text-sm font-medium" style={{ color: "var(--pp-muted)" }}>/ {totalTarget} soal</span>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 6,
                border: "1.5px solid var(--pp-ink)",
                backgroundColor: "var(--pp-bg)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  background: allMet
                    ? "linear-gradient(90deg, var(--pp-mint), #22c55e)"
                    : "linear-gradient(90deg, var(--pp-lemon), var(--pp-primary))",
                  transition: "width 400ms ease",
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs font-medium" style={{ color: "var(--pp-muted)" }}>{progressPct}%</span>
              {allMet && (
                <span
                  className="text-xs font-semibold flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "var(--pp-mint)", color: "var(--pp-ink)", border: "1px solid var(--pp-ink)" }}
                >
                  <Check className="w-3 h-3" />
                  Semua terpenuhi
                </span>
              )}
            </div>
          </div>

          {/* Soal yang babnya tidak ada di matriks.
              Akordeon di bawah dibangun dari matrixData, jadi soal yang nama
              babnya tak ada di sana tidak punya baris untuk ditampilkan — ia
              lenyap tanpa jejak. Itu yang terjadi pada 94 soal, 5 Sep 2026.
              Sejak trg_matriks_pindah_bawa_soal & trg_matriks_tolak_hapus_berisi
              (20260905000003) keadaan ini tidak bisa lagi lahir dari halaman
              Matrix, tapi panel ini tetap dipasang: kalau toh muncul lagi lewat
              jalan yang belum terpikir, guru melihatnya — bukan mengira soalnya
              terhapus. */}
          {(() => {
            const diMatriks = new Set(matrixData.map(b => (b.bab_id_text ?? "").trim().toLowerCase()))
            const yatim = soalList.filter(s => !diMatriks.has((s.bab_id_text ?? "").trim().toLowerCase()))
            if (yatim.length === 0) return null
            const perBab = new Map<string, number>()
            yatim.forEach(s => {
              const nama = (s.bab_id_text ?? "").trim() || "(tanpa bab)"
              perBab.set(nama, (perBab.get(nama) ?? 0) + 1)
            })
            return (
              <div
                style={{
                  backgroundColor: "#FFF0E6",
                  border: "1.5px solid var(--pp-ink)",
                  borderRadius: 22,
                  boxShadow: "4px 4px 0 0 var(--pp-ink)",
                  padding: "14px 16px",
                }}
              >
                <p className="text-sm font-semibold mb-1" style={{ color: "var(--pp-ink)" }}>
                  {yatim.length} soal tidak muncul di daftar bawah
                </p>
                <p className="text-xs mb-2" style={{ color: "var(--pp-ink-2)", lineHeight: 1.5 }}>
                  Soalnya <strong>tidak hilang</strong> — babnya saja yang tidak ada di matriks Anda,
                  jadi tidak ada tempat untuk menampilkannya. Tambahkan bab berikut di halaman
                  Matrix supaya soalnya muncul kembali:
                </p>
                <ul className="text-xs" style={{ color: "var(--pp-ink)" }}>
                  {[...perBab.entries()].map(([nama, jml]) => (
                    <li key={nama}>• <strong>{nama}</strong> — {jml} soal</li>
                  ))}
                </ul>
              </div>
            )
          })()}

          {/* Bab navigation */}
          <div
            id="tour-bab-nav"
            style={{
              backgroundColor: "var(--pp-card)",
              border: "1.5px solid var(--pp-ink)",
              borderRadius: 22,
              boxShadow: "4px 4px 0 0 var(--pp-ink)",
              overflow: "hidden",
            }}
          >
            {matrixData.map((bab, babIdx) => {
              const { done: babDone, total: babTotal } = getBabProgress(bab.bab_id_text)
              const isExpanded = expandedBabs.has(bab.bab_id_text)
              const isActive = activeBab === bab.bab_id_text
              const babAllMet = babTotal > 0 && babDone >= babTotal
              const babRevisiCount = soalList.filter(s => s.bab_id_text === bab.bab_id_text && s.status === "needs_revision").length

              return (
                <div
                  key={bab.bab_id_text}
                  style={{ borderTop: babIdx > 0 ? "1.5px solid var(--pp-ink)" : "none" }}
                >
                  {/* Bab header button */}
                  <button
                    className="w-full px-4 py-3 flex items-center justify-between text-left"
                    style={{ backgroundColor: isActive ? "var(--pp-lemon)" : "transparent" }}
                    onClick={() => {
                      selectBab(bab.bab_id_text)
                      if (!expandedBabs.has(bab.bab_id_text)) toggleBab(bab.bab_id_text)
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--pp-ink)" }}>
                        {bab.bab_id_text}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: babAllMet ? "#15803d" : "var(--pp-muted)" }}
                      >
                        {babDone}/{babTotal} soal
                        {babAllMet && " ✓"}
                      </p>
                    </div>
                    {babRevisiCount > 0 && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full font-bold shrink-0 mr-1"
                        style={{ backgroundColor: "var(--pp-pink)", color: "#be123c", border: "1px solid var(--pp-ink)" }}
                      >
                        {babRevisiCount}
                      </span>
                    )}
                    <div
                      role="button"
                      tabIndex={0}
                      className="p-0.5 flex-shrink-0"
                      style={{ color: "var(--pp-muted)" }}
                      onClick={e => { e.stopPropagation(); toggleBab(bab.bab_id_text) }}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleBab(bab.bab_id_text) } }}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {/* Slot list */}
                  {isExpanded && (
                    <div
                      className="px-3 pb-3 pt-1 space-y-1"
                      style={{ backgroundColor: "var(--pp-bg)" }}
                    >
                      {TIPE_OPTIONS.flatMap(tipe =>
                        KESULITAN_OPTIONS.map(kesulitan => {
                          const count = getSoalCount(bab.bab_id_text, tipe, kesulitan)
                          const target = getTargetBank(bab.bab_id_text, tipe, kesulitan)
                          if (target === 0) return null
                          const full = count >= target
                          const isSelected = isActive && selectedTipe === tipe && selectedKesulitan === kesulitan
                          return (
                            <div
                              key={`${tipe}_${kesulitan}`}
                              className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg transition-opacity"
                              style={{
                                backgroundColor: isSelected
                                  ? "var(--pp-ink)"
                                  : full
                                  ? "var(--pp-bg)"
                                  : "#fef2f2",
                                border: `1px solid ${isSelected ? "var(--pp-ink)" : full ? "var(--pp-line)" : "#fca5a5"}`,
                                cursor: full ? "not-allowed" : "pointer",
                                opacity: full && !isSelected ? 0.55 : 1,
                              }}
                              onClick={full ? undefined : () => openSlot(bab.bab_id_text, tipe, kesulitan)}
                            >
                              <span
                                className="font-medium"
                                style={{ color: isSelected ? "#fff" : full ? "var(--pp-muted)" : "#dc2626" }}
                              >
                                {TIPE_LABELS[tipe]} · {KESULITAN_LABELS[kesulitan] ?? kesulitan}
                              </span>
                              <span
                                className="flex items-center gap-0.5 font-semibold"
                                style={{ color: isSelected ? "#fff" : full ? "var(--pp-muted)" : "#dc2626" }}
                              >
                                {full ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                                {count}/{target}
                              </span>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Right Content ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* Form */}
          <div
            id="tour-form-soal"
            style={{
              backgroundColor: "var(--pp-card)",
              border: "1.5px solid var(--pp-ink)",
              borderRadius: 22,
              boxShadow: "4px 4px 0 0 var(--pp-ink)",
              overflow: "hidden",
            }}
          >
            {/* Form header band */}
            <div
              style={{
                backgroundColor: editingId ? "var(--pp-peach)" : "var(--pp-lemon)",
                borderBottom: "1.5px solid var(--pp-ink)",
                padding: "12px 20px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
            >
              <div>
                <div className="text-xs font-bold uppercase" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                  {editingId ? "Mode Edit" : "Tambah Soal"}
                </div>
                <div className="font-display font-semibold text-base" style={{ color: "var(--pp-ink)" }}>
                  {activeBab || "Pilih bab terlebih dahulu"}
                </div>
              </div>
              {editingId && (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: "var(--pp-ink)", color: "#fff" }}
                >
                  Sedang mengedit
                </span>
              )}
            </div>

            {!activeBab ? (
              <div
                className="text-sm text-center"
                style={{ padding: "48px 24px", color: "var(--pp-muted)" }}
              >
                Pilih bab dari navigasi kiri untuk mulai menambah soal
              </div>
            ) : (
              <div style={{ padding: "20px 20px" }} className="space-y-5">

                {/* Tipe */}
                <div id="tour-tipe-kesulitan">
                  <div className="text-xs font-bold uppercase mb-2" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                    Tipe Soal
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TIPE_OPTIONS.map(t => {
                      const isSelected = selectedTipe === t
                      const tc = TIPE_COLORS[t]
                      return (
                        <button
                          key={t}
                          onClick={() => {
                            setSelectedTipe(t)
                            setBobot(getDefaultBobot(t, selectedKesulitan))
                            // Benar/Salah selalu dua pilihan tetap — guru tidak
                            // perlu (dan tidak boleh) mengetiknya sendiri.
                            if (t === "benar_salah") {
                              setPilihan([...PILIHAN_BENAR_SALAH])
                              setPilihanGambar(["", ""])
                              setJawabanBenar(0)
                            }
                          }}
                          style={{
                            border: "1.5px solid var(--pp-ink)",
                            borderRadius: 20,
                            padding: "6px 14px",
                            fontSize: 13,
                            fontWeight: 600,
                            backgroundColor: isSelected ? "var(--pp-ink)" : tc.bg,
                            color: isSelected ? "#fff" : tc.accent,
                            boxShadow: isSelected ? "none" : "2px 2px 0 0 var(--pp-ink)",
                            transition: "all 80ms",
                          }}
                        >
                          {TIPE_LABELS[t]}
                        </button>
                      )
                    })}
                  </div>

                  {/* Kesulitan */}
                  <div className="text-xs font-bold uppercase mt-4 mb-2" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                    Tingkat Kesulitan
                  </div>
                  <div className="flex gap-2">
                    {KESULITAN_OPTIONS.map(k => {
                      const isSelected = selectedKesulitan === k
                      const kc = KESULITAN_COLORS[k]
                      return (
                        <button
                          key={k}
                          onClick={() => { setSelectedKesulitan(k); setBobot(getDefaultBobot(selectedTipe, k)) }}
                          style={{
                            border: "1.5px solid var(--pp-ink)",
                            borderRadius: 20,
                            padding: "6px 16px",
                            fontSize: 13,
                            fontWeight: 600,
                            backgroundColor: isSelected ? "var(--pp-ink)" : kc.bg,
                            color: isSelected ? "#fff" : kc.text,
                            boxShadow: isSelected ? "none" : "2px 2px 0 0 var(--pp-ink)",
                            transition: "all 80ms",
                          }}
                          title={KESULITAN_LABELS_PANJANG[k]}
                        >
                          {KESULITAN_LABELS[k] ?? k}
                        </button>
                      )
                    })}
                    <span
                      className="flex items-center text-xs font-semibold px-3 rounded-full"
                      style={{
                        border: "1.5px solid var(--pp-line)",
                        color: "var(--pp-ink-2)",
                        backgroundColor: "var(--pp-bg)",
                      }}
                    >
                      Bobot: {bobot}
                    </span>
                  </div>
                </div>

                {/* Pertanyaan */}
                <div id="tour-editor-pertanyaan">
                  <div className="text-xs font-bold uppercase mb-2" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                    Pertanyaan <span style={{ color: "#dc2626" }}>*</span>
                  </div>
                  <div
                    style={{
                      border: "1.5px solid var(--pp-ink)",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <RichTextEditor
                      content={pertanyaan}
                      onChange={setPertanyaan}
                      placeholder="Masukkan pertanyaan..."
                    />
                  </div>
                </div>

                {/* Pilihan jawaban */}
                {punyaPilihan(selectedTipe) && (
                  <div>
                    <div className="text-xs font-bold uppercase mb-3" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                      Pilihan Jawaban
                    </div>
                    <div className="space-y-3">
                      {pilihan.map((p, i) => {
                        const isBenar = satuJawaban(selectedTipe)
                          ? jawabanBenar === i
                          : jawabanBenarCeklist.includes(i)
                        return (
                          <div
                            key={i}
                            className="flex items-start gap-2"
                            style={{
                              border: `1.5px solid ${isBenar ? "#22c55e" : "var(--pp-line)"}`,
                              borderRadius: 12,
                              padding: "10px 12px",
                              backgroundColor: isBenar ? "#f0fdf4" : "var(--pp-bg)",
                            }}
                          >
                            <div className="mt-2 shrink-0">
                              {satuJawaban(selectedTipe) ? (
                                <input
                                  type="radio"
                                  name="jawabanBenar"
                                  checked={jawabanBenar === i}
                                  onChange={() => setJawabanBenar(i)}
                                  style={{ accentColor: "var(--pp-primary)" }}
                                />
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={jawabanBenarCeklist.includes(i)}
                                  onChange={e => setJawabanBenarCeklist(
                                    e.target.checked
                                      ? [...jawabanBenarCeklist, i]
                                      : jawabanBenarCeklist.filter(x => x !== i)
                                  )}
                                  style={{ accentColor: "var(--pp-primary)" }}
                                />
                              )}
                            </div>
                            <span
                              className="mt-2.5 w-5 text-sm font-bold flex-shrink-0"
                              style={{ color: isBenar ? "#15803d" : "var(--pp-muted)" }}
                            >
                              {String.fromCharCode(65 + i)}.
                            </span>
                            <div className="flex-1 min-w-0">
                              <RichTextEditor
                                mini
                                content={p}
                                onChange={html => { const n = [...pilihan]; n[i] = html; setPilihan(n) }}
                                placeholder={`Pilihan ${String.fromCharCode(65 + i)}`}
                              />
                            </div>
                            <div className="mt-1.5 shrink-0">
                              <ImageUpload
                                value={pilihanGambar[i]}
                                onChange={url => { const n = [...pilihanGambar]; n[i] = url; setPilihanGambar(n) }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Kunci isian singkat. Sebelumnya tipe ini sama sekali tidak
                    punya kunci — soal tersimpan tanpa jawaban benar, dan guru
                    penilai di LMS tidak punya acuan apa pun. */}
                {punyaRubrik(selectedTipe) && (
                  <div>
                    <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
                      <div className="text-xs font-bold uppercase" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                        Rubrik Penilaian
                      </div>
                      {rubrik.length > 0 && (
                        <div className="text-xs" style={{ color: totalPoinRubrik(rubrik) === bobot ? "#15803d" : "#b45309" }}>
                          {totalPoinRubrik(rubrik)} dari {bobot} poin
                          {totalPoinRubrik(rubrik) !== bobot && " — belum sama dengan bobot soal"}
                        </div>
                      )}
                    </div>

                    {/* Peringatan, bukan penolakan. Bobot bisa diubah admin di
                        halaman Patokan sesudah soal ditulis, jadi memaksa sama
                        di sini akan mengunci pekerjaan yang sah. */}
                    <div className="text-xs mb-2" style={{ color: "var(--pp-muted)" }}>
                      Dipakai penilai sebagai daftar centang. Kosongkan kalau soal ini dinilai tanpa rubrik.
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {rubrik.map((b, i) => (
                        <div key={i} className="flex gap-1.5 items-start">
                          <input
                            type="text"
                            value={b.kriteria}
                            onChange={e => {
                              const n = [...rubrik]; n[i] = { ...n[i], kriteria: e.target.value }; setRubrik(n)
                            }}
                            placeholder={`Kriteria ${i + 1} — mis. "Menuliskan rumus dengan benar"`}
                            className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                            style={{ border: "1.5px solid var(--pp-ink)", borderRadius: 10, backgroundColor: "var(--pp-bg)", color: "var(--pp-ink)" }}
                          />
                          <input
                            type="number" min="0" step="0.25"
                            value={b.poin}
                            onChange={e => {
                              const n = [...rubrik]; n[i] = { ...n[i], poin: parseFloat(e.target.value) || 0 }; setRubrik(n)
                            }}
                            className="w-20 shrink-0 px-2 py-2 text-sm text-center outline-none"
                            style={{ border: "1.5px solid var(--pp-ink)", borderRadius: 10, backgroundColor: "var(--pp-bg)", color: "var(--pp-ink)" }}
                          />
                          <button
                            type="button"
                            onClick={() => setRubrik(rubrik.filter((_, j) => j !== i))}
                            title="Hapus kriteria"
                            className="shrink-0 px-2.5 py-2 text-sm font-bold"
                            style={{ border: "1.5px solid var(--pp-ink)", borderRadius: 10, backgroundColor: "var(--pp-card)", color: "#dc2626" }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setRubrik([...rubrik, { kriteria: "", poin: 0 }])}
                        className="self-start text-xs font-semibold px-3 py-1.5 mt-0.5"
                        style={{ border: "1.5px dashed var(--pp-ink)", borderRadius: 999, backgroundColor: "transparent", color: "var(--pp-ink)" }}
                      >
                        + Tambah kriteria
                      </button>
                    </div>
                  </div>
                )}

                {punyaKunciTeks(selectedTipe) && (
                  <div>
                    <div className="text-xs font-bold uppercase mb-2" style={{ color: "var(--pp-muted)", letterSpacing: "0.1em" }}>
                      Kunci Jawaban <span style={{ color: "#dc2626" }}>*</span>
                    </div>
                    <input
                      type="text"
                      value={kunciIsian}
                      onChange={e => setKunciIsian(e.target.value)}
                      placeholder="fotosintesis, photosynthesis"
                      className="w-full px-3 py-2.5 text-sm outline-none"
                      style={{
                        border: `1.5px solid ${kunciSalah ? "#dc2626" : "var(--pp-ink)"}`,
                        borderRadius: 12,
                        backgroundColor: "var(--pp-card)",
                        color: "var(--pp-ink)",
                      }}
                    />

                    {/* Pecahan komanya ditampilkan balik. Tanpa ini guru tidak
                        punya cara tahu bahwa "km/jam" tetap satu kunci sedangkan
                        "HP, handphone" jadi dua — dan baru sadar setelah soalnya
                        dinilai salah. */}
                    {kunciDaftar.length > 0 && !kunciSalah && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {kunciDaftar.map((k, i) => (
                          <span
                            key={i}
                            className="text-[11px] px-2 py-0.5 font-semibold"
                            style={{
                              border: "1px solid var(--pp-ink)",
                              borderRadius: 999,
                              backgroundColor: "var(--pp-mint)",
                              color: "var(--pp-ink)",
                            }}
                          >
                            {k}
                          </span>
                        ))}
                        {kunciDaftar.length > 1 && (
                          <span className="text-[11px] self-center" style={{ color: "var(--pp-muted)" }}>
                            {kunciDaftar.length} alternatif — semuanya dianggap benar
                          </span>
                        )}
                      </div>
                    )}

                    <div className="text-[11px] mt-1.5" style={{ color: kunciSalah ? "#dc2626" : "var(--pp-muted)" }}>
                      {kunciSalah ?? "Tiap alternatif satu kata, dipisah koma. Tanda hubung & apostrof menyatu (\"anak-anak\" satu kata); garis miring TIDAK memisah, jadi \"km/jam\" tetap satu kunci."}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div id="tour-aksi-soal" className="flex gap-3 pt-1">
                  <button
                    onClick={handleSaveSoal}
                    disabled={saving}
                    onMouseDown={() => setSavePressed(true)}
                    onMouseUp={() => setSavePressed(false)}
                    onMouseLeave={() => setSavePressed(false)}
                    style={{
                      backgroundColor: "var(--pp-ink)",
                      color: "#fff",
                      border: "1.5px solid var(--pp-ink)",
                      borderRadius: 12,
                      padding: "10px 20px",
                      fontSize: 14,
                      fontWeight: 600,
                      boxShadow: savePressed ? "none" : "3px 3px 0 0 rgba(0,0,0,0.3)",
                      transform: savePressed ? "translate(2px,2px)" : "none",
                      transition: "all 80ms",
                      opacity: saving ? 0.6 : 1,
                      cursor: saving ? "not-allowed" : "pointer",
                    }}
                  >
                    {saving ? "Menyimpan..." : editingId ? "Update Soal" : "Simpan Soal"}
                  </button>
                  {editingId && (
                    <button
                      onClick={resetForm}
                      style={{
                        backgroundColor: "transparent",
                        color: "var(--pp-ink-2)",
                        border: "1.5px solid var(--pp-line)",
                        borderRadius: 12,
                        padding: "10px 16px",
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Batal Edit
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Soal list */}
          {activeBab && (
            <div
              id="tour-soal-list"
              style={{
                backgroundColor: "var(--pp-card)",
                border: "1.5px solid var(--pp-ink)",
                borderRadius: 22,
                boxShadow: "4px 4px 0 0 var(--pp-ink)",
                overflow: "hidden",
              }}
            >
              {/* List header */}
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: "1.5px solid var(--pp-ink)",
                  backgroundColor: "var(--pp-bg)",
                }}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <div className="font-display font-semibold text-base" style={{ color: "var(--pp-ink)" }}>
                    Daftar Soal — {activeBab}
                  </div>
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: "var(--pp-ink)", color: "#fff" }}
                  >
                    {filteredSoal.length}{filterTipe || filterKesulitan || filterStatus ? `/${activeBabSoal.length}` : ""} soal
                  </span>
                </div>

                {/* Filter pills */}
                <div className="flex flex-wrap gap-1.5">
                  {/* Status revisi filter */}
                  {(() => {
                    const revisiCount = activeBabSoal.filter(s => s.status === "needs_revision").length
                    if (revisiCount === 0) return null
                    const active = filterStatus === "needs_revision"
                    return (
                      <button
                        onClick={() => setFilterStatus(active ? null : "needs_revision")}
                        className="text-xs px-2.5 py-1 rounded-full font-semibold transition-all"
                        style={{
                          backgroundColor: active ? "#be123c" : "var(--pp-pink)",
                          color: active ? "#fff" : "#be123c",
                          border: `1.5px solid ${active ? "#be123c" : "var(--pp-line)"}`,
                          boxShadow: active ? "none" : "1px 1px 0 0 var(--pp-line)",
                        }}
                      >
                        Revisi ({revisiCount})
                      </button>
                    )
                  })()}

                  {/* Tipe filter */}
                  {TIPE_OPTIONS.map(tipe => {
                    const c = TIPE_COLORS[tipe]
                    const active = filterTipe === tipe
                    const count = activeBabSoal.filter(s => s.tipe === tipe).length
                    if (count === 0) return null
                    return (
                      <button
                        key={tipe}
                        onClick={() => setFilterTipe(active ? null : tipe)}
                        className="text-xs px-2.5 py-1 rounded-full font-semibold transition-all"
                        style={{
                          backgroundColor: active ? c.accent : c.bg,
                          color: active ? "#fff" : c.accent,
                          border: `1.5px solid ${active ? c.accent : "var(--pp-line)"}`,
                          boxShadow: active ? "none" : "1px 1px 0 0 var(--pp-line)",
                        }}
                      >
                        {TIPE_LABELS[tipe]} ({count})
                      </button>
                    )
                  })}

                  {/* Separator */}
                  {(filterTipe || filterKesulitan || TIPE_OPTIONS.some(t => activeBabSoal.some(s => s.tipe === t))) && (
                    <div style={{ width: 1, backgroundColor: "var(--pp-line)", margin: "0 2px" }} />
                  )}

                  {/* Kesulitan filter */}
                  {KESULITAN_OPTIONS.map(kes => {
                    const c = KESULITAN_COLORS[kes]
                    const active = filterKesulitan === kes
                    const count = activeBabSoal.filter(s => s.tingkat_kesulitan === kes).length
                    if (count === 0) return null
                    return (
                      <button
                        key={kes}
                        onClick={() => setFilterKesulitan(active ? null : kes)}
                        title={KESULITAN_LABELS_PANJANG[kes]}
                        className="text-xs px-2.5 py-1 rounded-full font-semibold transition-all"
                        style={{
                          backgroundColor: active ? "#374151" : c.bg,
                          color: active ? "#fff" : c.text,
                          border: `1.5px solid ${active ? "#374151" : "var(--pp-line)"}`,
                          boxShadow: active ? "none" : "1px 1px 0 0 var(--pp-line)",
                        }}
                      >
                        {KESULITAN_LABELS[kes] ?? kes} ({count})
                      </button>
                    )
                  })}

                  {/* Reset filter */}
                  {(filterTipe || filterKesulitan || filterStatus) && (
                    <button
                      onClick={() => { setFilterTipe(null); setFilterKesulitan(null); setFilterStatus(null) }}
                      className="text-xs px-2.5 py-1 rounded-full"
                      style={{
                        backgroundColor: "var(--pp-bg)",
                        color: "var(--pp-muted)",
                        border: "1.5px solid var(--pp-line)",
                      }}
                    >
                      × Reset
                    </button>
                  )}
                </div>
              </div>

              {filteredSoal.length === 0 ? (
                <div
                  className="text-sm text-center"
                  style={{ padding: "48px 24px", color: "var(--pp-muted)" }}
                >
                  {activeBabSoal.length === 0 ? "Belum ada soal untuk bab ini" : "Tidak ada soal yang cocok dengan filter"}
                </div>
              ) : (
                <div>
                  {filteredSoal.map((soal, idx) => {
                    const statusStyle = STATUS_STYLES[soal.status] || STATUS_STYLES["draft"]
                    const tipeColor = TIPE_COLORS[soal.tipe] || TIPE_COLORS["pilgan"]
                    const kesColor = KESULITAN_COLORS[soal.tingkat_kesulitan] || KESULITAN_COLORS["mudah"]
                    const canEdit = soal.status === "draft" || soal.status === "needs_revision" || !soal.status

                    return (
                      <div
                        key={soal.id}
                        style={{
                          padding: "16px 20px",
                          borderTop: idx > 0 ? "1.5px solid var(--pp-line)" : "none",
                          display: "flex", gap: 12, alignItems: "flex-start",
                        }}
                      >
                        {/* Number badge */}
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 font-display"
                          style={{
                            backgroundColor: "var(--pp-lemon)",
                            color: "var(--pp-ink)",
                            border: "1.5px solid var(--pp-ink)",
                          }}
                        >
                          {idx + 1}
                        </span>

                        <div className="flex-1 min-w-0">
                          {/* Pills row */}
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-semibold"
                              style={{ backgroundColor: tipeColor.bg, color: tipeColor.accent, border: "1px solid var(--pp-ink)" }}
                            >
                              {TIPE_LABELS[soal.tipe] || soal.tipe}
                            </span>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-semibold"
                              title={KESULITAN_LABELS_PANJANG[soal.tingkat_kesulitan]}
                              style={{ backgroundColor: kesColor.bg, color: kesColor.text, border: "1px solid var(--pp-ink)" }}
                            >
                              {KESULITAN_LABELS[soal.tingkat_kesulitan] ?? soal.tingkat_kesulitan}
                            </span>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-semibold"
                              style={{ backgroundColor: statusStyle.bg, color: statusStyle.text, border: "1px solid var(--pp-line)" }}
                            >
                              {statusStyle.label}
                            </span>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: "var(--pp-bg)", color: "var(--pp-ink-2)", border: "1px solid var(--pp-line)" }}
                            >
                              Bobot: {soal.bobot}
                            </span>
                          </div>

                          {/* Pertanyaan */}
                          <MathHtml
                            className="text-sm rich-html"
                            style={{ color: "var(--pp-ink)" }}
                            html={applyHighlights(soal.pertanyaan, soal.highlights || [], "pertanyaan")}
                          />

                          {/* Pilihan jawaban */}
                          {soal.pilihan && soal.pilihan.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {soal.pilihan.map((p: { id: number; teks: string; benar: boolean }, i: number) => {
                                const gambarUrl = soal.pilihan_gambar?.[p.id] || ""
                                const field = `pilihan_${i}`
                                return (
                                  <div
                                    key={p.id}
                                    className="flex items-start gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
                                    style={{
                                      backgroundColor: p.benar ? "#f0fdf4" : "var(--pp-bg)",
                                      border: `1px solid ${p.benar ? "#86efac" : "var(--pp-line)"}`,
                                    }}
                                  >
                                    <span
                                      className="font-bold flex-shrink-0 mt-0.5"
                                      style={{ color: p.benar ? "#15803d" : "var(--pp-muted)" }}
                                    >
                                      {String.fromCharCode(65 + p.id)}.
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      {p.teks && (
                                        <MathHtml
                                          className="rich-html"
                                          style={{ color: p.benar ? "#15803d" : "var(--pp-ink)" }}
                                          html={applyHighlights(p.teks, soal.highlights || [], field)}
                                        />
                                      )}
                                      {gambarUrl && (
                                        <img
                                          src={gambarUrl}
                                          alt={`Pilihan ${String.fromCharCode(65 + p.id)}`}
                                          style={{ maxWidth: 160, maxHeight: 100, marginTop: p.teks ? 4 : 0, borderRadius: 6, objectFit: "contain" }}
                                        />
                                      )}
                                    </div>
                                    {p.benar && <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#15803d" }} />}
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* Highlights chips (read-only) */}
                          {soal.highlights && soal.highlights.length > 0 && (
                            <div className="mt-2">
                              <div className="text-xs flex items-center gap-1 mb-1" style={{ color: "var(--pp-muted)" }}>
                                <Highlighter className="w-3 h-3" />
                                Ditandai validator:
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {soal.highlights.map((h: HighlightItem) => (
                                  <span
                                    key={h.id}
                                    className="text-xs px-2 py-0.5 rounded-full"
                                    style={{
                                      backgroundColor: h.color === "red" ? "#fecaca" : "#fef08a",
                                      border: "1px solid var(--pp-ink)",
                                      color: "var(--pp-ink)",
                                    }}
                                    title={h.note || undefined}
                                  >
                                    "{h.text.length > 30 ? h.text.slice(0, 30) + "…" : h.text}"
                                    {h.note && <span style={{ color: "var(--pp-muted)" }}> — {h.note}</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Revision notes */}
                          {soal.revision_notes && (
                            <div
                              className="mt-2 text-xs px-3 py-2 rounded-lg"
                              style={{
                                backgroundColor: "#fff0f5",
                                color: "#be123c",
                                border: "1px solid var(--pp-pink)",
                              }}
                            >
                              <span className="font-semibold">Catatan revisi:</span> {soal.revision_notes}
                            </div>
                          )}

                          {/* Komentar guru pengampu mapel */}
                          <button
                            onClick={() => bukaKomentar(soal.id)}
                            className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full"
                            style={{
                              backgroundColor: komentarSoalId === soal.id ? "var(--pp-ink)" : "var(--pp-bg)",
                              color: komentarSoalId === soal.id ? "white" : "var(--pp-ink)",
                              border: "1px solid var(--pp-ink)",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            {jumlahKomentar[soal.id] > 0
                              ? `${jumlahKomentar[soal.id]} komentar`
                              : "Komentar"}
                            {komentarSoalId === soal.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>

                          {komentarSoalId === soal.id && (
                            <div
                              className="mt-2 rounded-[14px] p-3 space-y-3"
                              style={{ backgroundColor: "var(--pp-bg)", border: "1.5px solid var(--pp-line)" }}
                            >
                              {memuatUtas && (
                                <div className="text-xs" style={{ color: "var(--pp-muted)" }}>Memuat komentar...</div>
                              )}

                              {galatKomentar && (
                                <div className="text-xs px-3 py-2 rounded-lg flex items-start gap-1.5"
                                     style={{ backgroundColor: "#FFE4E4", border: "1px solid #FECACA", color: "#B91C1C" }}>
                                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                  {galatKomentar}
                                </div>
                              )}

                              {!memuatUtas && utasKomentar.length === 0 && !galatKomentar && (
                                <div className="text-xs" style={{ color: "var(--pp-muted)" }}>
                                  Belum ada komentar dari guru lain. Komentar akan muncul di sini.
                                </div>
                              )}

                              {susunUtas(utasKomentar).map(({ induk, balasan }) => (
                                <div key={induk.id} className="rounded-[12px] p-2.5"
                                     style={{ backgroundColor: "var(--pp-card)", border: "1px solid var(--pp-line)" }}>
                                  <BarisKomentar k={induk} onHapus={() => hapusKomentarSoal(soal.id, induk.id)} />
                                  {balasan.length > 0 && (
                                    <div className="mt-2 pl-3 space-y-2" style={{ borderLeft: "2px solid var(--pp-line)" }}>
                                      {balasan.map(b => (
                                        <BarisKomentar key={b.id} k={b} onHapus={() => hapusKomentarSoal(soal.id, b.id)} />
                                      ))}
                                    </div>
                                  )}

                                  {balasKe === induk.id ? (
                                    <div className="mt-2 space-y-1.5">
                                      <textarea
                                        value={drafBalasan}
                                        onChange={e => setDrafBalasan(e.target.value)}
                                        rows={2}
                                        maxLength={2000}
                                        placeholder="Tulis balasan..."
                                        style={textareaKomentar}
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => kirimKomentarBaru(soal.id, induk.id)}
                                          disabled={mengirimKomentar || !drafBalasan.trim()}
                                          className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1"
                                          style={tombolKirimKomentar(mengirimKomentar || !drafBalasan.trim())}
                                        >
                                          <Send className="w-3 h-3" />
                                          {mengirimKomentar ? "Mengirim..." : "Kirim balasan"}
                                        </button>
                                        <button
                                          onClick={() => { setBalasKe(null); setDrafBalasan("") }}
                                          className="text-xs px-2 py-1.5"
                                          style={{ color: "var(--pp-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                                        >
                                          Batal
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => { setBalasKe(induk.id); setDrafBalasan(""); setGalatKomentar("") }}
                                      className="text-xs mt-1.5"
                                      style={{ color: "var(--pp-primary)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                                    >
                                      Balas
                                    </button>
                                  )}
                                </div>
                              ))}

                              <div>
                                <textarea
                                  value={drafKomentar}
                                  onChange={e => setDrafKomentar(e.target.value)}
                                  rows={2}
                                  maxLength={2000}
                                  placeholder="Tanggapi komentar untuk soal Anda..."
                                  style={textareaKomentar}
                                />
                                <div className="flex items-center justify-between mt-1.5">
                                  <span className="text-xs" style={{ color: "var(--pp-muted)" }}>
                                    {drafKomentar.length}/2000
                                  </span>
                                  <button
                                    onClick={() => kirimKomentarBaru(soal.id, null)}
                                    disabled={mengirimKomentar || !drafKomentar.trim()}
                                    className="text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1"
                                    style={tombolKirimKomentar(mengirimKomentar || !drafKomentar.trim())}
                                  >
                                    <Send className="w-3 h-3" />
                                    Kirim
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Edit/Delete */}
                        {canEdit && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleEditSoal(soal)}
                              title="Edit"
                              style={{
                                width: 32, height: 32,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                border: "1.5px solid var(--pp-ink)",
                                borderRadius: 8,
                                backgroundColor: "var(--pp-lemon)",
                                color: "var(--pp-ink)",
                                boxShadow: "2px 2px 0 0 var(--pp-ink)",
                                cursor: "pointer",
                              }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteSoal(soal.id)}
                              title="Hapus"
                              style={{
                                width: 32, height: 32,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                border: "1.5px solid var(--pp-ink)",
                                borderRadius: 8,
                                backgroundColor: "var(--pp-pink)",
                                color: "var(--pp-ink)",
                                boxShadow: "2px 2px 0 0 var(--pp-ink)",
                                cursor: "pointer",
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Batch Upload Modal */}
      {showBatchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) { setShowBatchModal(false); setBatchPasteText(""); setBatchRaw([]); setBatchErrors([]) } }}
        >
          <div
            style={{
              backgroundColor: "var(--pp-card)",
              border: "2px solid var(--pp-ink)",
              borderRadius: 24,
              boxShadow: "6px 6px 0 0 var(--pp-ink)",
              width: "100%",
              maxWidth: 640,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div
              style={{
                backgroundColor: "var(--pp-lemon)",
                borderBottom: "2px solid var(--pp-ink)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div className="flex items-center gap-2">
                <FileJson className="w-5 h-5" style={{ color: "var(--pp-ink)" }} />
                <span className="font-display font-bold text-base" style={{ color: "var(--pp-ink)" }}>
                  Upload Soal Batch (JSON)
                </span>
              </div>
              <button
                onClick={() => { setShowBatchModal(false); setBatchPasteText(""); setBatchRaw([]); setBatchErrors([]) }}
                style={{ color: "var(--pp-ink-2)", padding: 4, borderRadius: 8, cursor: "pointer" }}
                className="hover:opacity-70 transition-opacity"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto flex-1" style={{ padding: "20px" }}>

              {/* Bab yang valid */}
              <div
                className="text-xs mb-4 p-3 rounded-xl"
                style={{ backgroundColor: "var(--pp-bg)", border: "1px solid var(--pp-line)" }}
              >
                <span className="font-bold" style={{ color: "var(--pp-ink)" }}>Bab tersedia: </span>
                <span style={{ color: "var(--pp-muted)" }}>
                  {matrixData.map(b => `"${b.bab_id_text}"`).join(", ")}
                </span>
              </div>

              {/* Download template */}
              <button
                onClick={downloadBatchTemplate}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  border: "1.5px dashed var(--pp-ink)",
                  borderRadius: 12,
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  backgroundColor: "var(--pp-bg)",
                  color: "var(--pp-ink)",
                  cursor: "pointer",
                  marginBottom: 16,
                }}
              >
                <FileJson className="w-4 h-4" />
                Download Template JSON
              </button>

              {/* File input */}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  border: "1.5px dashed var(--pp-ink)",
                  borderRadius: 14,
                  padding: "24px 16px",
                  cursor: "pointer",
                  backgroundColor: batchRaw.length > 0 ? "var(--pp-mint)" : "var(--pp-bg)",
                  transition: "background-color 200ms",
                  marginBottom: 16,
                }}
              >
                <Upload className="w-6 h-6" style={{ color: "var(--pp-ink-2)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--pp-ink)" }}>
                  {batchRaw.length > 0
                    ? `${batchRaw.length} soal terbaca — klik untuk ganti file`
                    : "Klik untuk pilih file .json"}
                </span>
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleBatchFileChange}
                />
              </label>

              {/* Paste JSON */}
              <div className="flex items-center gap-3 mb-4">
                <div style={{ flex: 1, height: 1, backgroundColor: "var(--pp-line)" }} />
                <span className="text-xs font-medium" style={{ color: "var(--pp-muted)" }}>atau paste JSON langsung</span>
                <div style={{ flex: 1, height: 1, backgroundColor: "var(--pp-line)" }} />
              </div>
              <textarea
                value={batchPasteText}
                onChange={handleBatchPasteChange}
                placeholder={'[\n  {\n    "pertanyaan": "...",\n    "tipe": "pilgan",\n    "tingkat_kesulitan": "mudah",\n    "bab_id_text": "Bab 1",\n    "pilihan": [...]\n  }\n]'}
                rows={7}
                className="w-full text-xs resize-y mb-4"
                style={{
                  border: "1.5px solid var(--pp-ink)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  backgroundColor: "var(--pp-bg)",
                  color: "var(--pp-ink)",
                  outline: "none",
                  fontFamily: "monospace",
                  lineHeight: 1.5,
                }}
                onFocus={e => { e.target.style.borderColor = "var(--pp-primary)"; e.target.style.boxShadow = "2px 2px 0 0 var(--pp-primary)" }}
                onBlur={e => { e.target.style.borderColor = "var(--pp-ink)"; e.target.style.boxShadow = "none" }}
              />

              {/* Errors */}
              {batchErrors.length > 0 && (
                <div
                  className="rounded-xl p-3 mb-4 space-y-1"
                  style={{ backgroundColor: "#fef2f2", border: "1.5px solid #fca5a5" }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <span className="text-xs font-bold text-red-700">
                      {batchErrors.length} error ditemukan — perbaiki sebelum upload
                    </span>
                  </div>
                  {batchErrors.map((e, i) => (
                    <div key={i} className="text-xs text-red-600 pl-6">• {e}</div>
                  ))}
                </div>
              )}

              {/* Preview table */}
              {batchRaw.length > 0 && batchErrors.length === 0 && (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ border: "1.5px solid var(--pp-ink)" }}
                >
                  <div
                    className="text-xs font-bold uppercase px-4 py-2"
                    style={{
                      backgroundColor: "var(--pp-bg)",
                      borderBottom: "1px solid var(--pp-line)",
                      color: "var(--pp-muted)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Preview — {batchRaw.length} soal
                  </div>
                  {batchRaw.map((item: any, i: number) => {
                    const tc = TIPE_COLORS[item.tipe] || TIPE_COLORS["pilgan"]
                    const kc = KESULITAN_COLORS[item.tingkat_kesulitan] || KESULITAN_COLORS["mudah"]
                    return (
                      <div
                        key={i}
                        style={{
                          padding: "12px 16px",
                          borderTop: i > 0 ? "1px solid var(--pp-line)" : "none",
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                        }}
                      >
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 font-display"
                          style={{ backgroundColor: "var(--pp-lemon)", color: "var(--pp-ink)", border: "1.5px solid var(--pp-ink)" }}
                        >
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap gap-1 mb-1">
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: tc.bg, color: tc.accent, border: "1px solid var(--pp-ink)" }}>
                              {TIPE_LABELS[item.tipe] || item.tipe}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" title={KESULITAN_LABELS_PANJANG[item.tingkat_kesulitan]} style={{ backgroundColor: kc.bg, color: kc.text, border: "1px solid var(--pp-ink)" }}>
                              {KESULITAN_LABELS[item.tingkat_kesulitan] ?? item.tingkat_kesulitan}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--pp-bg)", color: "var(--pp-ink-2)", border: "1px solid var(--pp-line)" }}>
                              {item.bab_id_text}
                            </span>
                          </div>
                          <div className="text-sm" style={{ color: "var(--pp-ink)" }}>
                            {item.pertanyaan}
                          </div>
                          {Array.isArray(item.pilihan) && item.pilihan.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {item.pilihan.map((p: any, j: number) => (
                                <div key={j} className="text-xs flex items-start gap-1" style={{ color: p.benar ? "#15803d" : "var(--pp-muted)" }}>
                                  <span className="font-bold">{String.fromCharCode(65 + j)}.</span>
                                  <span>{p.teks}{p.benar ? " ✓" : ""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div
              style={{
                padding: "16px 20px",
                borderTop: "1.5px solid var(--pp-ink)",
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => setShowBatchModal(false)}
                style={{
                  border: "1.5px solid var(--pp-line)",
                  borderRadius: 12,
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  backgroundColor: "transparent",
                  color: "var(--pp-ink-2)",
                  cursor: "pointer",
                }}
              >
                Batal
              </button>
              <button
                onClick={handleBatchInsert}
                disabled={batchSaving || batchErrors.length > 0 || batchRaw.length === 0}
                style={{
                  border: "1.5px solid var(--pp-ink)",
                  borderRadius: 12,
                  padding: "10px 24px",
                  fontSize: 14,
                  fontWeight: 600,
                  backgroundColor: batchErrors.length === 0 && batchRaw.length > 0 ? "var(--pp-ink)" : "var(--pp-bg)",
                  color: batchErrors.length === 0 && batchRaw.length > 0 ? "#fff" : "var(--pp-muted)",
                  cursor: batchErrors.length === 0 && batchRaw.length > 0 && !batchSaving ? "pointer" : "not-allowed",
                  boxShadow: batchErrors.length === 0 && batchRaw.length > 0 ? "3px 3px 0 0 rgba(0,0,0,0.2)" : "none",
                  opacity: batchSaving ? 0.6 : 1,
                }}
              >
                {batchSaving ? "Menyimpan..." : `Upload ${batchRaw.length > 0 ? batchRaw.length + " " : ""}Soal`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

/* ── Potongan UI komentar (dipakai di panel dalam daftar soal) ── */

function BarisKomentar({ k, onHapus }: { k: KomentarSoal; onHapus: () => void }) {
  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold" style={{ color: "var(--pp-ink)" }}>{k.nama}</span>
        <span
          className="px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: "var(--pp-bg)", color: "var(--pp-ink-2)", border: "1px solid var(--pp-line)", fontSize: 10 }}
        >
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

const textareaKomentar: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1.5px solid var(--pp-ink)",
  backgroundColor: "var(--pp-card)",
  fontSize: 12,
  color: "var(--pp-ink)",
  outline: "none",
  fontFamily: "inherit",
  resize: "vertical",
  boxSizing: "border-box",
}

const tombolKirimKomentar = (nonaktif: boolean): React.CSSProperties => ({
  backgroundColor: nonaktif ? "var(--pp-bg)" : "var(--pp-primary)",
  color: nonaktif ? "var(--pp-muted)" : "white",
  border: "none",
  cursor: nonaktif ? "not-allowed" : "pointer",
  fontFamily: "inherit",
})

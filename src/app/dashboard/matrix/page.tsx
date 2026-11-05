"use client"

import React, { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, CircleHelp, MessageCircle, Pencil, X, ArrowLeft } from "lucide-react"
import ThemeToggle from "@/components/ThemeToggle"
import { supabase } from "@/lib/supabase"
import Toast from "@/components/Toast"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"
import {
  TIPE_OPTIONS,
  KESULITAN_OPTIONS,
  KESULITAN_LABELS,
  KESULITAN_LABELS_PANJANG,
  TIPE_LABELS,
  warnaTipe,
  labelUjian,
  ambilTugasMenulis,
  ambilPatokanUjian,
  ambilBabUjian,
  buatBabUjian,
  pesanError,
  type TugasMenulis,
  type BabUjian,
} from "@/lib/ujian"
import { ambilAksesSaya } from "@/lib/komentar"

interface Bab {
  /** Kunci lokal = bab_id_text; matrixData masih dikunci dengan ini. */
  id: string
  nama_bab: string
  /**
   * Identitas bab di LMS. Wajib terisi sebelum matriks bisa disinkronkan —
   * nama saja tidak cukup: mengganti nama bab TIDAK ikut memperbarui
   * psat.bank_soal.bab_id_text, jadi nama bukan identitas yang stabil.
   */
  bab_id: string | null
  is_submitted: boolean
}

/** Ujian yang sedang dikerjakan, dibagi antar halaman lewat localStorage. */
const UJIAN_KEY = "psat_ujian_id"

const INITIAL_DATA: Record<string, number> = {}
TIPE_OPTIONS.forEach(t => KESULITAN_OPTIONS.forEach(k => {
  INITIAL_DATA[`${t}_${k}_keluar`] = 0
  INITIAL_DATA[`${t}_${k}_bank`] = 0
}))

// Warna tipe berasal dari lib/ujian — dulu array posisional 4 entri di sini.

export default function MatrixPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [guruMapelId, setGuruMapelId] = useState<string | null>(null)
  const [babs, setBabs] = useState<Bab[]>([])
  const [matrixData, setMatrixData] = useState<Record<string, Record<string, number>>>({})
  const matrixDataRef = useRef<Record<string, Record<string, number>>>({})
  const [patokan, setPatokan] = useState<Record<string, number>>({ ...INITIAL_DATA })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [newBabName, setNewBabName] = useState("")
  /** Nama bab baru yang diketik guru saat babnya belum ada di LMS. */
  const [babBaruNama, setBabBaruNama] = useState("")
  const [membuatBab, setMembuatBab] = useState(false)
  const [editingBab, setEditingBab] = useState<string | null>(null)
  const [editBabName, setEditBabName] = useState("")
  const [guruNama, setGuruNama] = useState("")
  const [guruMapelNama, setGuruMapelNama] = useState("")
  const [tugasList, setTugasList] = useState<TugasMenulis[]>([])
  const [tugasAktif, setTugasAktif] = useState<TugasMenulis | null>(null)
  const [babSaran, setBabSaran] = useState<BabUjian[]>([])
  const [requestingEdit, setRequestingEdit] = useState(false)
  const [submitPressed, setSubmitPressed] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type })
  }

  const startTour = () => {
    const driverObj = driver({
      showProgress: true,
      nextBtnText: "Lanjut →",
      prevBtnText: "← Kembali",
      doneBtnText: "Selesai",
      steps: [
        {
          element: "#tour-progress",
          popover: {
            title: "Progress vs Patokan",
            description: "Perbandingan jumlah soal aktual vs target dari admin. Hijau = tepat sesuai target, Merah = kurang atau melebihi target.",
          },
        },
        {
          element: "#tour-bab-pills",
          popover: {
            title: "Daftar Bab",
            description: "Setiap pill adalah satu bab. Klik pill untuk MEMINDAH baris ini ke bab lain — nama bab sendiri diubah di LMS, dan perubahannya otomatis menyusul ke sini. Tombol × untuk menghapus bab yang belum disubmit.",
          },
        },
        {
          element: "#tour-tambah-bab",
          popover: {
            title: "Tambah Bab",
            description: "Klik untuk menambah bab baru. Ketik nama bab lalu tekan Enter atau klik ✓ untuk menyimpan.",
            side: "bottom",
          },
        },
        {
          element: "#tour-matrix-table",
          popover: {
            title: "Tabel Input Matrix",
            description: "Isi jumlah soal di kolom setiap bab. 'Soal' = jumlah soal yang keluar di ujian, 'Bank' = total soal yang disiapkan. Data tersimpan otomatis saat berpindah kolom.",
            side: "top",
          },
        },
        {
          element: "#tour-submit",
          popover: {
            title: "Submit Matrix",
            description: "Setelah semua angka sesuai patokan (semua indikator hijau), klik Submit Semua. Setelah submit, matrix terkunci dan kamu bisa mulai input soal.",
            side: "bottom",
          },
        },
      ],
    })
    driverObj.drive()
  }

  const loadBabsFromDB = async (userId: string, ujianId: string, mapelId: string | null = null, saranBab: BabUjian[] = []) => {
    const { data } = await supabase
      .from("psat_matrix_input")
      .select("bab_id_text, bab_id, data, is_submitted")
      .eq("profile_id", userId)
      .eq("ujian_id", ujianId)

    if (data && data.length > 0) {
      const dataMap: Record<string, Record<string, number>> = {}
      data.forEach(b => {
        let parsed = b.data
        if (typeof parsed === "string") { try { parsed = JSON.parse(parsed) } catch { parsed = null } }
        dataMap[b.bab_id_text] = { ...INITIAL_DATA, ...(parsed || {}) }
      })
      matrixDataRef.current = dataMap
      setMatrixData(dataMap)
      setBabs(data.map(b => ({ id: b.bab_id_text, nama_bab: b.bab_id_text, bab_id: b.bab_id ?? null, is_submitted: b.is_submitted })))
    } else {
      // Dulu di-hardcode "Bab 1" — nama yang belum tentu ada di LMS, sehingga
      // barisnya tak pernah bisa dipetakan ke bab_pelajaran. Sekarang diambil
      // dari daftar bab ujian itu sendiri; kalau LMS belum punya bab, jangan
      // membuat baris apa pun dan biarkan layar kosong menjelaskan sebabnya.
      const saran = saranBab.length > 0 ? saranBab : await ambilBabUjianAman(ujianId)
      const pertama = saran[0]
      if (!pertama) {
        matrixDataRef.current = {}
        setMatrixData({})
        setBabs([])
        return
      }
      await supabase.from("psat_matrix_input").insert({
        profile_id: userId, mapel_id: mapelId, ujian_id: ujianId,
        bab_id_text: pertama.nama_bab, bab_id: pertama.bab_id,
        data: { ...INITIAL_DATA }, is_submitted: false,
      })
      matrixDataRef.current = { [pertama.nama_bab]: { ...INITIAL_DATA } }
      setMatrixData({ [pertama.nama_bab]: { ...INITIAL_DATA } })
      setBabs([{ id: pertama.nama_bab, nama_bab: pertama.nama_bab, bab_id: pertama.bab_id, is_submitted: false }])
    }
  }

  /** Saran bab dari LMS; kegagalan jaringan tidak boleh menggagalkan halaman. */
  const ambilBabUjianAman = async (ujianId: string): Promise<BabUjian[]> => {
    try { return await ambilBabUjian(ujianId) } catch { return [] }
  }

  /** Pindah ke satu tugas: muat bab, target, dan saran bab milik ujian itu. */
  const pilihTugas = async (userId: string, tugas: TugasMenulis) => {
    setTugasAktif(tugas)
    setGuruMapelId(tugas.psat_mapel_id)
    setGuruMapelNama(tugas.mapel_nama || tugas.ujian_nama)
    localStorage.setItem(UJIAN_KEY, tugas.ujian_id)

    // Saran bab dimuat DULU: loadBabsFromDB memakainya untuk bab pertama.
    const saran = await ambilBabUjianAman(tugas.ujian_id)
    setBabSaran(saran)

    await loadBabsFromDB(userId, tugas.ujian_id, tugas.psat_mapel_id, saran)

    try {
      setPatokan(await ambilPatokanUjian(tugas.ujian_id))
    } catch {
      setPatokan({ ...INITIAL_DATA })
    }
  }

  useEffect(() => {
    async function load() {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) { router.push("/login"); return }
      setUser(u)

      // Matrix hanya milik penulis. Guru pengampu yang masuk untuk berkomentar
      // dialihkan ke sana, bukan dibiarkan menekan simpan yang akan ditolak.
      const akses = await ambilAksesSaya().catch(() => null)
      if (!akses?.bisa_menulis) {
        showToast("Halaman ini untuk penulis soal. Anda bisa memberi komentar lewat menu Komentar.", "info")
        setTimeout(() => router.push("/dashboard"), 1500)
        return
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("nama, no_hp")
        .eq("id", u.id)
        .maybeSingle()

      const { data: guruData } = await supabase
        .from("psat_guru_data")
        .select("mapel_id, bank, no_rekening, unit_sekolah")
        .eq("profile_id", u.id)
        .maybeSingle()

      // Mapel & kelas tidak lagi diisi guru — keduanya datang dari penugasan
      // di LMS. Yang tersisa untuk dilengkapi sendiri hanya data honor.
      const missing: string[] = []
      if (!profileData?.nama || profileData.nama === u.id) missing.push("Nama")
      if (!profileData?.no_hp) missing.push("No HP")
      if (!guruData?.unit_sekolah) missing.push("Unit Sekolah")
      if (!guruData?.bank) missing.push("Bank")
      if (!guruData?.no_rekening) missing.push("No Rekening")

      if (missing.length > 0) {
        showToast(`Lengkapi profil dulu: ${missing.join(", ")}`, "info")
        setTimeout(() => router.push("/dashboard/profile"), 1500)
        return
      }

      setGuruNama(profileData?.nama || "")

      let tugas: TugasMenulis[] = []
      try {
        tugas = await ambilTugasMenulis()
      } catch (e) {
        showToast("Gagal memuat tugas menulis: " + pesanError(e), "error")
        setLoading(false)
        return
      }
      setTugasList(tugas)

      if (tugas.length === 0) {
        setLoading(false)
        return
      }

      // Ingat pilihan terakhir supaya pindah halaman tidak mereset konteks
      const tersimpan = localStorage.getItem(UJIAN_KEY)
      const terpilih = tugas.find(t => t.ujian_id === tersimpan) ?? tugas[0]
      await pilihTugas(u.id, terpilih)
      setLoading(false)
      if (!localStorage.getItem("matrix_tour_done")) {
        localStorage.setItem("matrix_tour_done", "1")
        setTimeout(() => startTour(), 300)
      }
    }
    load()
    // pilihTugas sengaja tidak masuk deps: efek ini hanya untuk pemuatan awal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const setMatrixDataSync = (newData: Record<string, Record<string, number>>) => {
    matrixDataRef.current = newData
    setMatrixData(newData)
  }

  const getTotals = () => {
    const totals: Record<string, number> = {}
    TIPE_OPTIONS.forEach(t => KESULITAN_OPTIONS.forEach(k => {
      totals[`${t}_${k}_keluar`] = Object.values(matrixDataRef.current).reduce((s, d) => s + (d?.[`${t}_${k}_keluar`] || 0), 0)
      totals[`${t}_${k}_bank`] = Object.values(matrixDataRef.current).reduce((s, d) => s + (d?.[`${t}_${k}_bank`] || 0), 0)
    }))
    return totals
  }

  const validateAll = (): string[] => {
    const errors: string[] = []

    babs.forEach(bab => {
      const d = matrixDataRef.current[bab.id] || {}
      TIPE_OPTIONS.forEach(t => KESULITAN_OPTIONS.forEach(k => {
        const bank = d[`${t}_${k}_bank`] || 0
        const keluar = d[`${t}_${k}_keluar`] || 0
        if (bank > 0 && keluar === 0)
          errors.push(`${bab.nama_bab} - ${TIPE_LABELS[t]} ${k}: bank soal (${bank}) terisi tapi soal keluar belum diisi`)
      }))
    })

    const totals = getTotals()
    TIPE_OPTIONS.forEach(t => KESULITAN_OPTIONS.forEach(k => {
      const tk = `${t}_${k}_keluar`, tb = `${t}_${k}_bank`
      if (patokan[tk] > 0 && totals[tk] !== patokan[tk])
        errors.push(`${TIPE_LABELS[t]} ${k} soal keluar: target ${patokan[tk]}, aktual ${totals[tk]}`)
      if (patokan[tb] > 0 && totals[tb] !== patokan[tb])
        errors.push(`${TIPE_LABELS[t]} ${k} bank: target ${patokan[tb]}, aktual ${totals[tb]}`)
    }))

    return errors
  }

  /** Sisipkan satu bab (yang sudah punya bab_id LMS) ke matriks guru. */
  const pasangBab = async (dipilih: { bab_id: string; nama_bab: string }) => {
    if (!user || !tugasAktif) return
    if (babs.some(b => b.bab_id === dipilih.bab_id)) {
      showToast("Bab itu sudah ada di matriks Anda", "error")
      return
    }
    const { error } = await supabase.from("psat_matrix_input").insert({
      profile_id: user.id, mapel_id: guruMapelId, ujian_id: tugasAktif.ujian_id,
      bab_id_text: dipilih.nama_bab, bab_id: dipilih.bab_id,
      data: { ...INITIAL_DATA }, is_submitted: false,
    })
    if (error) { showToast("Error: " + error.message, "error"); return }
    setBabs(prev => [...prev, { id: dipilih.nama_bab, nama_bab: dipilih.nama_bab, bab_id: dipilih.bab_id, is_submitted: false }])
    setMatrixDataSync({ ...matrixDataRef.current, [dipilih.nama_bab]: { ...INITIAL_DATA } })
    setNewBabName("")
    setBabBaruNama("")
    setIsAdding(false)
  }

  const handleAddBab = async () => {
    if (!newBabName || !tugasAktif) { showToast("Pilih bab dari daftar", "error"); return }
    const dipilih = babSaran.find(b => b.bab_id === newBabName)
    if (!dipilih) { showToast("Pilih bab dari daftar", "error"); return }
    await pasangBab(dipilih)
  }

  /**
   * Buat bab baru di LMS lalu langsung pasang ke matriks.
   *
   * Dropdown bab diisi dari bab_pelajaran milik LMS. Sebelum ini, guru mentok
   * bila babnya belum ada di sana — PSAT tidak punya jalur menulis bab sama
   * sekali. RPC-nya bersifat ambil-atau-buat, jadi menekan tombol dua kali
   * tidak menggandakan bab.
   */
  const handleBuatBab = async () => {
    const nama = babBaruNama.trim()
    if (!nama || !tugasAktif) return
    setMembuatBab(true)
    try {
      const hasil = await buatBabUjian(tugasAktif.ujian_id, nama)
      setBabSaran(await ambilBabUjianAman(tugasAktif.ujian_id))
      if (hasil.sudah_ada) showToast(`Bab "${hasil.nama_bab}" sudah ada — dipakai yang itu`, "success")
      await pasangBab({ bab_id: hasil.bab_id, nama_bab: hasil.nama_bab })
    } catch (e) {
      showToast("Gagal membuat bab: " + pesanError(e), "error")
    } finally {
      setMembuatBab(false)
    }
  }

  /**
   * Berapa soal yang sudah ditulis di bawah satu bab, untuk ujian yang aktif.
   *
   * Mengembalikan null bila tidak bisa dipastikan — dan pemanggilnya WAJIB
   * berhenti, bukan menganggapnya nol. Menganggap "tidak tahu" sama dengan
   * "kosong" persis bagaimana 94 soal sempat ditinggalkan tanpa ada yang tahu.
   */
  const jumlahSoalBab = async (namaBab: string): Promise<number | null> => {
    if (!user || !tugasAktif) return null
    const { count, error } = await supabase
      .from("bank_soal")
      .select("id", { count: "exact", head: true })
      .eq("guru_id", user.id)
      .eq("ujian_id", tugasAktif.ujian_id)
      .eq("bab_id_text", namaBab)
    if (error) return null
    return count ?? 0
  }

  const handleDeleteBab = async (babId: string) => {
    if (babs.find(b => b.id === babId)?.is_submitted) return

    // Database menolak ini sejak 20260905000003 (trg_matriks_tolak_hapus_berisi).
    // Pemeriksaan di sini bukan penjaga — ia hanya supaya guru mendapat kalimat
    // yang bisa ditindaklanjuti, bukan galat mentah setelah menekan tombol.
    const jml = await jumlahSoalBab(babId)
    if (jml === null) {
      showToast("Tidak bisa memeriksa isi bab ini. Coba lagi sebentar.", "error")
      return
    }
    if (jml > 0) {
      showToast(`Bab "${babId}" berisi ${jml} soal. Pindahkan bab ini ke bab lain (soalnya ikut) atau hapus soalnya dulu.`, "error")
      return
    }
    if (!confirm(`Hapus "${babId}"? Data matrix akan hilang.`)) return
    const { error } = await supabase.from("psat_matrix_input").delete()
      .eq("profile_id", user.id).eq("ujian_id", tugasAktif?.ujian_id ?? "").eq("bab_id_text", babId)
    if (error) { showToast("Error: " + error.message, "error"); return }
    setBabs(prev => prev.filter(b => b.id !== babId))
    const newData = { ...matrixDataRef.current }
    delete newData[babId]
    setMatrixDataSync(newData)
  }

  const handleRenameBab = async (oldId: string, namaBaru?: string) => {
    // namaBaru dikirim langsung oleh <select>: setEditBabName belum tentu
    // terbaca di render yang sama, dan membaca state basi akan memindahkan
    // baris ke bab yang salah tanpa gejala apa pun.
    const diminta = (namaBaru ?? editBabName).trim()
    if (!diminta || !user || babs.find(b => b.id === oldId)?.is_submitted) {
      setEditingBab(null); return
    }
    // Nama harus tetap cocok dengan sebuah bab di LMS. Dulu bebas, dan itu
    // memutus dua hal sekaligus: baris ini tak bisa dipetakan ke bab_pelajaran,
    // dan soal yang sudah ditulis tetap memakai nama LAMA di
    // psat.bank_soal.bab_id_text karena rename tidak pernah menyentuhnya.
    const cocok = babSaran.find(b => b.nama_bab.toLowerCase() === diminta.toLowerCase())
    if (!cocok) {
      showToast("Nama itu tidak ada di daftar bab LMS. Pilih yang tersedia.", "error")
      return
    }
    // Soal yang sudah ditulis IKUT pindah — dikerjakan trigger
    // trg_matriks_pindah_bawa_soal (20260905000003), jadi kedua tulisan itu
    // satu transaksi dan tidak bisa setengah jadi. Yang dikerjakan di sini
    // hanya memberi tahu: perpindahan diam-diam justru bagaimana 94 soal
    // sempat lenyap dari layar penulisnya, 5 Sep 2026.
    const ikut = await jumlahSoalBab(oldId)
    if (ikut === null) {
      showToast("Tidak bisa memeriksa isi bab ini. Coba lagi sebentar.", "error")
      return
    }
    if (ikut > 0 && !confirm(
      `Bab "${oldId}" berisi ${ikut} soal.\n\nSoal itu akan ikut pindah ke "${cocok.nama_bab}". Lanjutkan?`
    )) return

    const { error: errPindah } = await supabase.from("psat_matrix_input")
      .update({ bab_id_text: cocok.nama_bab, bab_id: cocok.bab_id, updated_at: new Date().toISOString() })
      .eq("profile_id", user.id).eq("ujian_id", tugasAktif?.ujian_id ?? "").eq("bab_id_text", oldId)
    if (errPindah) {
      showToast("Gagal memindahkan bab: " + errPindah.message, "error")
      return
    }
    if (ikut > 0) showToast(`${ikut} soal ikut pindah ke "${cocok.nama_bab}"`, "success")
    const newData = { ...matrixDataRef.current }
    newData[cocok.nama_bab] = newData[oldId]
    delete newData[oldId]
    setBabs(prev => prev.map(b => b.id === oldId ? { ...b, id: cocok.nama_bab, nama_bab: cocok.nama_bab, bab_id: cocok.bab_id } : b))
    setMatrixDataSync(newData)
    setEditingBab(null)
    setEditBabName("")
  }

  const handleFieldChange = (babId: string, field: string, value: number) => {
    if (field.endsWith("_keluar")) {
      const bankField = field.replace("_keluar", "_bank")
      const currentBank = matrixDataRef.current[babId]?.[bankField] || 0
      if (value > 0 && currentBank === 0) { showToast("Isi bank soal dulu sebelum mengisi soal keluar", "error"); return }
      if (value > currentBank) { showToast(`Soal keluar (${value}) tidak boleh melebihi bank soal (${currentBank})`, "error"); return }
      if (currentBank > 0 && value === 0) { showToast("Soal keluar minimal 1 jika bank soal > 0", "error"); return }
    }
    setMatrixDataSync({
      ...matrixDataRef.current,
      [babId]: { ...matrixDataRef.current[babId], [field]: value },
    })
  }

  const handleSave = async (babId: string) => {
    if (!user || !matrixDataRef.current[babId]) return
    await supabase.from("psat_matrix_input")
      .update({ data: matrixDataRef.current[babId], updated_at: new Date().toISOString() })
      .eq("profile_id", user.id).eq("ujian_id", tugasAktif?.ujian_id ?? "").eq("bab_id_text", babId)
  }

  const handleSubmitAll = async () => {
    if (!user || !tugasAktif) return
    const errors = validateAll()
    if (errors.length > 0) { showToast("Belum sesuai patokan: " + errors[0], "error"); return }
    setSaving(true)
    try {
      // Simpan angka terbaru DULU supaya uji-coba menilai grid yang benar-benar
      // akan dikirim, bukan versi lama di database.
      for (const bab of babs) {
        await supabase.from("psat_matrix_input")
          .update({ data: matrixDataRef.current[bab.id], updated_at: new Date().toISOString() })
          .eq("profile_id", user.id).eq("ujian_id", tugasAktif.ujian_id).eq("bab_id_text", bab.id)
      }

      // Uji-coba: kumpulkan SEMUA masalah sebelum mengunci apa pun. Tanpa ini,
      // kegagalan sinkronisasi meninggalkan matriks terkunci tapi tak pernah
      // sampai ke LMS — guru terkunci dari matriks yang belum berlaku.
      const { data: uji, error: ujiErr } = await supabase.rpc("sinkron_konfigurasi_bab", {
        p_ujian_id: tugasAktif.ujian_id, p_profile_id: null, p_dry_run: true,
      })
      if (ujiErr) throw new Error(ujiErr.message)
      const hasil = uji as { ok: boolean; masalah?: { pesan: string }[] } | null
      if (hasil && !hasil.ok) {
        showToast(hasil.masalah?.map(m => m.pesan).join(" · ") || "Matriks belum bisa dikirim", "error")
        return
      }

      for (const bab of babs.filter(b => !b.is_submitted)) {
        await supabase.from("psat_matrix_input")
          .update({ is_submitted: true, updated_at: new Date().toISOString() })
          .eq("profile_id", user.id).eq("ujian_id", tugasAktif.ujian_id).eq("bab_id_text", bab.id)
      }

      const { error: sinkErr } = await supabase.rpc("sinkron_konfigurasi_bab", {
        p_ujian_id: tugasAktif.ujian_id, p_profile_id: null, p_dry_run: false,
      })
      if (sinkErr) {
        // Balikkan kuncinya: matriks terkunci yang tidak sampai ke LMS lebih
        // buruk daripada matriks yang masih bisa disunting.
        await supabase.from("psat_matrix_input")
          .update({ is_submitted: false })
          .eq("profile_id", user.id).eq("ujian_id", tugasAktif.ujian_id)
        throw new Error(sinkErr.message)
      }

      showToast("Matrix disubmit dan dikirim ke LMS!", "success")
    } catch (e) {
      showToast("Gagal submit: " + pesanError(e), "error")
    } finally {
      setSaving(false)
      await loadBabsFromDB(user.id, tugasAktif.ujian_id, tugasAktif.psat_mapel_id, babSaran)
    }
  }

  const handleRequestEdit = async () => {
    if (!user || !tugasAktif) return
    setRequestingEdit(true)
    try {
      const [{ data: profileData }, { data: { session } }] = await Promise.all([
        supabase.from("profiles").select("nama").eq("id", user.id).maybeSingle(),
        supabase.auth.getSession(),
      ])
      const namaGuru = (profileData as { nama?: string } | null)?.nama || guruNama || "Guru"
      // Sebut kelasnya juga — admin bisa punya beberapa permintaan dari guru yang sama
      const namaMapel = labelUjian(tugasAktif)

      await fetch("/api/notifications/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          type: "request_matrix_edit",
          guruNama: namaGuru,
          mapelNama: namaMapel,
        }),
      }).catch(() => {})
      showToast("Permintaan edit dikirim ke admin via WhatsApp", "success")
    } catch {
      showToast("Gagal mengirim notifikasi", "error")
    }
    setRequestingEdit(false)
  }

  if (loading) return (
    <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }} className="flex items-center justify-center">
      <div className="font-display text-xl" style={{ color: "var(--pp-ink-2)" }}>Memuat...</div>
    </div>
  )

  // Tanpa penugasan di LMS tidak ada matrix yang bisa diisi — dan guru tidak
  // bisa menyelesaikannya sendiri, jadi arahkan ke orang yang bisa.
  if (tugasList.length === 0) return (
    <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }} className="flex items-center justify-center px-4">
      <div
        className="text-center px-6 py-12 max-w-lg"
        style={{
          backgroundColor: "var(--pp-card)",
          border: "1.5px solid var(--pp-ink)",
          borderRadius: 22,
          boxShadow: "6px 6px 0 0 var(--pp-ink)",
        }}
      >
        <div className="font-display font-semibold text-lg mb-2" style={{ color: "var(--pp-ink)" }}>
          Belum ada tugas menulis
        </div>
        <p className="text-sm mb-5" style={{ color: "var(--pp-muted)" }}>
          Matrix diisi per ujian. Anda akan melihat daftarnya di sini setelah super admin
          membuat ujian untuk siklus yang aktif <strong>dan</strong> Anda tercatat mengampu
          mata pelajaran serta kelasnya di LMS.
        </p>
        <button
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{
            backgroundColor: "var(--pp-lemon)",
            color: "var(--pp-ink)",
            border: "1.5px solid var(--pp-ink)",
            borderRadius: 12,
            padding: "8px 16px",
            boxShadow: "3px 3px 0 0 var(--pp-ink)",
          }}
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Dashboard
        </button>
      </div>
    </div>
  )

  const totals = getTotals()

  return (
    <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10"
        style={{ backgroundColor: "var(--pp-card)", borderBottom: "1.5px solid var(--pp-ink)" }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
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
              <span className="font-display font-bold text-sm text-white">M</span>
            </div>
            <div className="min-w-0">
              <div className="font-display font-semibold text-base leading-tight truncate" style={{ color: "var(--pp-ink)" }}>
                Input Matrix
              </div>
              {tugasAktif && (
                <div className="text-xs leading-tight truncate" style={{ color: "var(--pp-muted)" }}>
                  {labelUjian(tugasAktif)}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div id="tour-submit" className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <button
              onClick={startTour}
              title="Panduan"
              className="hover:opacity-70 transition-opacity"
              style={{ color: "var(--pp-ink-2)", padding: 6, borderRadius: 8 }}
            >
              <CircleHelp className="w-5 h-5" />
            </button>

            {babs.some(b => !b.is_submitted) && (
              <button
                onClick={handleSubmitAll}
                disabled={saving}
                onMouseDown={() => setSubmitPressed(true)}
                onMouseUp={() => setSubmitPressed(false)}
                onMouseLeave={() => setSubmitPressed(false)}
                style={{
                  backgroundColor: "var(--pp-ink)",
                  color: "#fff",
                  border: "1.5px solid var(--pp-ink)",
                  borderRadius: 12,
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: submitPressed ? "none" : "3px 3px 0 0 rgba(0,0,0,0.35)",
                  transform: submitPressed ? "translate(2px,2px)" : "none",
                  transition: "all 80ms",
                  opacity: saving ? 0.6 : 1,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Menyimpan..." : "Submit Semua"}
              </button>
            )}

            {babs.length > 0 && babs.every(b => b.is_submitted) && (
              <button
                onClick={handleRequestEdit}
                disabled={requestingEdit}
                className="flex items-center gap-1.5"
                style={{
                  backgroundColor: "var(--pp-lemon)",
                  color: "var(--pp-ink)",
                  border: "1.5px solid var(--pp-ink)",
                  borderRadius: 12,
                  padding: "8px 14px",
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: "3px 3px 0 0 var(--pp-ink)",
                  opacity: requestingEdit ? 0.6 : 1,
                  cursor: requestingEdit ? "not-allowed" : "pointer",
                }}
              >
                <MessageCircle className="w-4 h-4" />
                {requestingEdit ? "Mengirim..." : "Minta Edit Ulang"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Back link */}
      <div className="max-w-5xl mx-auto px-4 pt-4 pb-1">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
          style={{ color: "var(--pp-muted)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Dashboard
        </button>
      </div>

      {/* Guru bisa mengampu lebih dari satu mapel/kelas — satu matrix per ujian */}
      {tugasList.length > 1 && (
        <div className="max-w-5xl mx-auto px-4 pt-2">
          <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--pp-muted)" }}>
            Tugas menulis Anda
          </div>
          <div className="flex flex-wrap gap-2">
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
                  className="flex items-center gap-1.5 text-sm"
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
                  {t.matrix_submitted && <Check className="w-3.5 h-3.5" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-4 pb-12 space-y-5">

        {/* Progress vs Patokan */}
        <div
          id="tour-progress"
          style={{
            backgroundColor: "var(--pp-card)",
            border: "1.5px solid var(--pp-ink)",
            borderRadius: 22,
            boxShadow: "4px 4px 0 0 var(--pp-ink)",
            padding: "20px 24px",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <div
                className="text-xs font-bold uppercase mb-0.5"
                style={{ color: "var(--pp-muted)", letterSpacing: "0.12em" }}
              >
                Progres
              </div>
              <div className="font-display font-semibold text-lg" style={{ color: "var(--pp-ink)" }}>
                Progress vs Patokan
              </div>
            </div>
            <span
              className="text-xs font-semibold px-3 py-1 rounded-full"
              style={{
                backgroundColor: "var(--pp-lemon)",
                color: "var(--pp-ink)",
                border: "1.5px solid var(--pp-ink)",
              }}
            >
              aktual / target
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {TIPE_OPTIONS.map((tipe) => {
              const tc = warnaTipe(tipe)
              return (
                <div
                  key={tipe}
                  style={{
                    backgroundColor: tc.bg,
                    border: "1.5px solid var(--pp-ink)",
                    borderRadius: 14,
                    padding: "12px 14px",
                    boxShadow: "2px 2px 0 0 var(--pp-ink)",
                  }}
                >
                  <div className="font-semibold text-sm mb-2.5" style={{ color: tc.accent }}>
                    {TIPE_LABELS[tipe]}
                  </div>
                  {KESULITAN_OPTIONS.map(k => {
                    const ak = totals[`${tipe}_${k}_keluar`] || 0
                    const ab = totals[`${tipe}_${k}_bank`] || 0
                    const tk = patokan[`${tipe}_${k}_keluar`] || 0
                    const tb = patokan[`${tipe}_${k}_bank`] || 0
                    const okK = tk > 0 && ak === tk
                    const okB = tb > 0 && ab === tb
                    return (
                      <div key={k} className="mb-2">
                        <div className="text-xs font-medium mb-1" title={KESULITAN_LABELS_PANJANG[k]} style={{ color: "var(--pp-ink-2)" }}>
                          {KESULITAN_LABELS[k] ?? k}
                        </div>
                        <div className="flex gap-1">
                          <span
                            className="flex-1 px-1 py-0.5 rounded text-xs text-center flex items-center justify-center gap-0.5 font-medium"
                            style={{
                              backgroundColor: tk === 0 ? "rgba(0,0,0,0.06)" : okK ? "#f0fdf4" : "#fef2f2",
                              color: tk === 0 ? "var(--pp-muted)" : okK ? "#15803d" : "#dc2626",
                            }}
                          >
                            {tk > 0 && (okK ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />)}
                            {ak}/{tk}
                          </span>
                          <span
                            className="flex-1 px-1 py-0.5 rounded text-xs text-center flex items-center justify-center gap-0.5 font-medium"
                            style={{
                              backgroundColor: tb === 0 ? "rgba(0,0,0,0.06)" : okB ? "#f0fdf4" : "#fef2f2",
                              color: tb === 0 ? "var(--pp-muted)" : okB ? "#15803d" : "#dc2626",
                            }}
                          >
                            {tb > 0 && (okB ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />)}
                            {ab}/{tb}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* Manajemen Bab */}
        <div
          style={{
            backgroundColor: "var(--pp-card)",
            border: "1.5px solid var(--pp-ink)",
            borderRadius: 22,
            boxShadow: "4px 4px 0 0 var(--pp-ink)",
            padding: "20px 24px",
          }}
        >
          <div
            className="text-xs font-bold uppercase mb-3"
            style={{ color: "var(--pp-muted)", letterSpacing: "0.12em" }}
          >
            Manajemen Bab
          </div>

          <div id="tour-bab-pills" className="flex flex-wrap gap-2 items-center">
            {babs.map(bab => (
              <div key={bab.id} className="flex items-center gap-1">
                {!bab.is_submitted && editingBab === bab.id ? (
                  <select
                    autoFocus
                    value={editBabName}
                    onChange={e => { setEditBabName(e.target.value); handleRenameBab(bab.id, e.target.value) }}
                    onBlur={() => setEditingBab(null)}
                    className="px-3 py-1.5 text-sm font-medium"
                    style={{
                      border: "1.5px solid var(--pp-primary)",
                      borderRadius: 20,
                      color: "var(--pp-ink)",
                      backgroundColor: "var(--pp-card)",
                      outline: "none",
                      boxShadow: "2px 2px 0 0 var(--pp-primary)",
                    }}
                  >
                    {babSaran.map(b => (
                      <option key={b.bab_id} value={b.nama_bab}>{b.nama_bab}</option>
                    ))}
                  </select>
                ) : (
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-transform"
                    style={{
                      border: "1.5px solid var(--pp-ink)",
                      borderRadius: 20,
                      boxShadow: bab.is_submitted ? "none" : "2px 2px 0 0 var(--pp-ink)",
                      backgroundColor: bab.is_submitted ? "var(--pp-mint)" : "var(--pp-card)",
                      color: "var(--pp-ink)",
                      cursor: bab.is_submitted ? "default" : "pointer",
                    }}
                    onClick={() => {
                      if (!bab.is_submitted) {
                        setEditingBab(bab.id)
                        setEditBabName(bab.nama_bab)
                      }
                    }}
                  >
                    {bab.is_submitted
                      ? <Check className="w-3.5 h-3.5 shrink-0" />
                      : <Pencil className="w-3 h-3 shrink-0 opacity-60" />
                    }
                    {bab.nama_bab}
                  </button>
                )}
                {!bab.is_submitted && (
                  <button
                    onClick={() => handleDeleteBab(bab.id)}
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      backgroundColor: "var(--pp-pink)",
                      color: "var(--pp-ink)",
                      border: "1px solid var(--pp-ink)",
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {/* `[].every()` bernilai true, jadi syarat lama menyembunyikan tombol
                justru saat babs KOSONG — persis keadaan guru yang baru mulai,
                dan layar kosong di bawah menyuruh menekan tombol yang tak ada.
                Kosong = belum ada yang terkunci, jadi harus tampil. */}
            {(babs.length === 0 || !babs.every(b => b.is_submitted)) && (
              isAdding ? (
                <div className="flex items-center gap-1.5">
                  {/* Bab HARUS dari daftar LMS: nama bebas tidak bisa dipetakan
                      ke bab_pelajaran, dan matriksnya akan ditolak saat submit. */}
                  <select
                    autoFocus
                    value={newBabName}
                    onChange={e => setNewBabName(e.target.value)}
                    className="px-3 py-1.5 text-sm w-44"
                    style={{
                      border: "1.5px solid var(--pp-primary)",
                      borderRadius: 20,
                      color: "var(--pp-ink)",
                      backgroundColor: "var(--pp-card)",
                      outline: "none",
                      boxShadow: "2px 2px 0 0 var(--pp-primary)",
                    }}
                  >
                    <option value="">Pilih bab…</option>
                    {babSaran
                      .filter(b => !babs.some(x => x.bab_id === b.bab_id))
                      .map(b => (
                        <option key={b.bab_id} value={b.bab_id}>{b.nama_bab}</option>
                      ))}
                  </select>
                  <button onClick={handleAddBab} className="font-bold" style={{ color: "#15803d" }}>✓</button>
                  <button onClick={() => { setIsAdding(false); setNewBabName(""); setBabBaruNama("") }} style={{ color: "var(--pp-muted)" }}>×</button>

                  {/* Babnya belum ada di LMS? Buat dari sini — tanpa ini guru
                      mentok, karena dropdown hanya berisi bab_pelajaran LMS. */}
                  <span className="text-xs" style={{ color: "var(--pp-muted)" }}>atau</span>
                  <input
                    type="text"
                    value={babBaruNama}
                    onChange={e => setBabBaruNama(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !membuatBab) handleBuatBab() }}
                    placeholder="bab baru…"
                    disabled={membuatBab}
                    className="px-3 py-1.5 text-sm w-36"
                    style={{
                      border: "1.5px dashed var(--pp-ink)",
                      borderRadius: 20,
                      color: "var(--pp-ink)",
                      backgroundColor: "var(--pp-card)",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={handleBuatBab}
                    disabled={membuatBab || !babBaruNama.trim()}
                    className="font-bold text-sm"
                    style={{ color: babBaruNama.trim() ? "#1d4ed8" : "var(--pp-muted)" }}
                  >
                    {membuatBab ? "…" : "+ buat"}
                  </button>
                </div>
              ) : (
                <button
                  id="tour-tambah-bab"
                  onClick={() => setIsAdding(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
                  style={{
                    border: "1.5px dashed var(--pp-ink)",
                    borderRadius: 20,
                    color: "var(--pp-ink-2)",
                    backgroundColor: "transparent",
                  }}
                >
                  + Tambah Bab
                </button>
              )
            )}
          </div>
        </div>

        {/* Matrix Table */}
        {babs.length === 0 ? (
          <div
            style={{
              border: "1.5px dashed var(--pp-ink)",
              borderRadius: 22,
              padding: "48px 24px",
              textAlign: "center",
              color: "var(--pp-muted)",
            }}
          >
            Klik &quot;+ Tambah Bab&quot; untuk menambah bab/chapter.
            {babSaran.length === 0 && (
              <div className="text-xs mt-2">
                Mata pelajaran ini belum punya bab di LMS — ketik nama bab baru
                di kotak &quot;bab baru…&quot; lalu tekan <b>+ buat</b>.
              </div>
            )}
          </div>
        ) : (
          <div
            id="tour-matrix-table"
            style={{
              border: "1.5px solid var(--pp-ink)",
              borderRadius: 22,
              boxShadow: "6px 6px 0 0 var(--pp-ink)",
              overflow: "hidden",
            }}
          >
            <div className="overflow-x-auto">
              <table
                className="text-sm border-collapse w-full"
                style={{ minWidth: `${260 + babs.length * 160}px` }}
              >
                <thead>
                  <tr style={{ backgroundColor: "var(--pp-lemon)" }}>
                    <th
                      className="border px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wide"
                      style={{ borderColor: "var(--pp-ink)", color: "var(--pp-ink-2)" }}
                      rowSpan={2}
                    >
                      Tipe
                    </th>
                    <th
                      className="border px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wide"
                      style={{ borderColor: "var(--pp-ink)", color: "var(--pp-ink-2)" }}
                      rowSpan={2}
                    >
                      Tingkat
                    </th>
                    {babs.map(bab => (
                      <th
                        key={bab.id}
                        className="border px-3 py-2.5 text-center font-semibold text-sm"
                        style={{ borderColor: "var(--pp-ink)", color: "var(--pp-ink)" }}
                        colSpan={2}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          {bab.is_submitted && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "#15803d" }} />}
                          {bab.nama_bab}
                        </div>
                      </th>
                    ))}
                    <th
                      className="border px-3 py-2.5 text-center font-semibold text-sm"
                      style={{ borderColor: "var(--pp-ink)", color: "var(--pp-ink)" }}
                      colSpan={2}
                    >
                      Total
                    </th>
                  </tr>
                  <tr style={{ backgroundColor: "var(--pp-lemon)" }}>
                    {babs.map(bab => (
                      <React.Fragment key={bab.id}>
                        <th className="border px-2 py-1.5 text-center text-xs font-semibold" style={{ borderColor: "var(--pp-ink)", color: "#15803d" }}>Soal</th>
                        <th className="border px-2 py-1.5 text-center text-xs font-semibold" style={{ borderColor: "var(--pp-ink)", color: "#b45309" }}>Bank</th>
                      </React.Fragment>
                    ))}
                    <th className="border px-2 py-1.5 text-center text-xs font-semibold" style={{ borderColor: "var(--pp-ink)", color: "#15803d" }}>Soal</th>
                    <th className="border px-2 py-1.5 text-center text-xs font-semibold" style={{ borderColor: "var(--pp-ink)", color: "#b45309" }}>Bank</th>
                  </tr>
                </thead>
                <tbody>
                  {TIPE_OPTIONS.map((tipe, ti) => {
                    const rowBg = ti % 2 === 0 ? "var(--pp-card)" : "var(--pp-bg)"
                    const warna = warnaTipe(tipe)
                    const tipeBg = warna.bg
                    return (
                      <React.Fragment key={tipe}>
                        {KESULITAN_OPTIONS.map((k, ki) => {
                          const rowSoal = babs.reduce((s, bab) => s + ((matrixData[bab.id] || INITIAL_DATA)[`${tipe}_${k}_keluar`] || 0), 0)
                          const rowBank = babs.reduce((s, bab) => s + ((matrixData[bab.id] || INITIAL_DATA)[`${tipe}_${k}_bank`] || 0), 0)
                          return (
                            <tr key={`${tipe}-${k}`} style={{ backgroundColor: rowBg }}>
                              {ki === 0 && (
                                <td
                                  className="border px-3 py-2 font-semibold text-sm"
                                  style={{
                                    borderColor: "var(--pp-ink)",
                                    color: warna.accent,
                                    verticalAlign: "middle",
                                    backgroundColor: tipeBg,
                                  }}
                                  rowSpan={KESULITAN_OPTIONS.length + 1}
                                >
                                  {TIPE_LABELS[tipe]}
                                </td>
                              )}
                              <td
                                className="border px-3 py-2 text-xs font-medium"
                                title={KESULITAN_LABELS_PANJANG[k]}
                                style={{ borderColor: "var(--pp-ink)", color: "var(--pp-ink-2)" }}
                              >
                                {KESULITAN_LABELS[k] ?? k}
                              </td>
                              {babs.map(bab => {
                                const p = matrixData[bab.id] || INITIAL_DATA
                                const submitted = bab.is_submitted
                                const inputStyle: React.CSSProperties = {
                                  border: "1.5px solid var(--pp-ink)",
                                  borderRadius: 8,
                                  backgroundColor: submitted ? "var(--pp-bg)" : "var(--pp-card)",
                                  color: "var(--pp-ink)",
                                  cursor: submitted ? "not-allowed" : "auto",
                                  opacity: submitted ? 0.6 : 1,
                                  outline: "none",
                                }
                                return (
                                  <React.Fragment key={bab.id}>
                                    <td className="border px-1.5 py-1.5" style={{ borderColor: "var(--pp-ink)" }}>
                                      <input
                                        type="number"
                                        min="0"
                                        value={p[`${tipe}_${k}_keluar`] || 0}
                                        onChange={e => !submitted && handleFieldChange(bab.id, `${tipe}_${k}_keluar`, parseInt(e.target.value) || 0)}
                                        disabled={submitted}
                                        className="w-14 px-1 py-1 text-xs text-center font-medium"
                                        style={inputStyle}
                                        onFocus={e => { if (!submitted) { e.target.style.borderColor = "var(--pp-primary)"; e.target.style.boxShadow = "2px 2px 0 0 var(--pp-primary)" } }}
                                        onBlur={e => { e.target.style.borderColor = "var(--pp-ink)"; e.target.style.boxShadow = "none"; if (!submitted) handleSave(bab.id) }}
                                      />
                                    </td>
                                    <td className="border px-1.5 py-1.5" style={{ borderColor: "var(--pp-ink)" }}>
                                      <input
                                        type="number"
                                        min="0"
                                        value={p[`${tipe}_${k}_bank`] || 0}
                                        onChange={e => !submitted && handleFieldChange(bab.id, `${tipe}_${k}_bank`, parseInt(e.target.value) || 0)}
                                        disabled={submitted}
                                        className="w-14 px-1 py-1 text-xs text-center font-medium"
                                        style={inputStyle}
                                        onFocus={e => { if (!submitted) { e.target.style.borderColor = "var(--pp-primary)"; e.target.style.boxShadow = "2px 2px 0 0 var(--pp-primary)" } }}
                                        onBlur={e => { e.target.style.borderColor = "var(--pp-ink)"; e.target.style.boxShadow = "none"; if (!submitted) handleSave(bab.id) }}
                                      />
                                    </td>
                                  </React.Fragment>
                                )
                              })}
                              <td className="border px-2 py-1.5 text-center text-xs font-bold" style={{ borderColor: "var(--pp-ink)", backgroundColor: "#f0fdf4", color: "#15803d" }}>{rowSoal}</td>
                              <td className="border px-2 py-1.5 text-center text-xs font-bold" style={{ borderColor: "var(--pp-ink)", backgroundColor: "#fefce8", color: "#b45309" }}>{rowBank}</td>
                            </tr>
                          )
                        })}

                        {/* Total per tipe */}
                        <tr style={{ backgroundColor: tipeBg, borderBottom: "2px solid var(--pp-ink)" }}>
                          <td className="border px-3 py-1.5 text-xs font-bold" style={{ borderColor: "var(--pp-ink)", color: "var(--pp-ink-2)" }}>Total</td>
                          {babs.map(bab => {
                            const p = matrixData[bab.id] || INITIAL_DATA
                            const colSoal = KESULITAN_OPTIONS.reduce((s, k) => s + (p[`${tipe}_${k}_keluar`] || 0), 0)
                            const colBank = KESULITAN_OPTIONS.reduce((s, k) => s + (p[`${tipe}_${k}_bank`] || 0), 0)
                            return (
                              <React.Fragment key={bab.id}>
                                <td className="border px-2 py-1.5 text-center text-xs font-bold" style={{ borderColor: "var(--pp-ink)", color: "#15803d" }}>{colSoal}</td>
                                <td className="border px-2 py-1.5 text-center text-xs font-bold" style={{ borderColor: "var(--pp-ink)", color: "#b45309" }}>{colBank}</td>
                              </React.Fragment>
                            )
                          })}
                          <td className="border px-2 py-1.5 text-center text-xs font-bold" style={{ borderColor: "var(--pp-ink)", color: "#15803d" }}>
                            {babs.reduce((s, bab) => {
                              const p = matrixData[bab.id] || INITIAL_DATA
                              return s + KESULITAN_OPTIONS.reduce((ss, k) => ss + (p[`${tipe}_${k}_keluar`] || 0), 0)
                            }, 0)}
                          </td>
                          <td className="border px-2 py-1.5 text-center text-xs font-bold" style={{ borderColor: "var(--pp-ink)", color: "#b45309" }}>
                            {babs.reduce((s, bab) => {
                              const p = matrixData[bab.id] || INITIAL_DATA
                              return s + KESULITAN_OPTIONS.reduce((ss, k) => ss + (p[`${tipe}_${k}_bank`] || 0), 0)
                            }, 0)}
                          </td>
                        </tr>
                      </React.Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: "var(--pp-mint)", borderTop: "2px solid var(--pp-ink)" }}>
                    <td
                      colSpan={2}
                      className="border px-3 py-2.5 text-sm font-bold"
                      style={{ borderColor: "var(--pp-ink)", color: "var(--pp-ink)" }}
                    >
                      Grand Total
                    </td>
                    {babs.map(bab => {
                      const p = matrixData[bab.id] || INITIAL_DATA
                      const grandSoal = TIPE_OPTIONS.reduce((s, t) => s + KESULITAN_OPTIONS.reduce((ss, k) => ss + (p[`${t}_${k}_keluar`] || 0), 0), 0)
                      const grandBank = TIPE_OPTIONS.reduce((s, t) => s + KESULITAN_OPTIONS.reduce((ss, k) => ss + (p[`${t}_${k}_bank`] || 0), 0), 0)
                      return (
                        <React.Fragment key={bab.id}>
                          <td className="border px-2 py-2.5 text-center text-sm font-bold" style={{ borderColor: "var(--pp-ink)", color: "#15803d" }}>{grandSoal}</td>
                          <td className="border px-2 py-2.5 text-center text-sm font-bold" style={{ borderColor: "var(--pp-ink)", color: "#b45309" }}>{grandBank}</td>
                        </React.Fragment>
                      )
                    })}
                    <td className="border px-2 py-2.5 text-center text-sm font-bold" style={{ borderColor: "var(--pp-ink)", color: "#15803d" }}>
                      {TIPE_OPTIONS.reduce((s, t) => s + KESULITAN_OPTIONS.reduce((ss, k) => ss + (totals[`${t}_${k}_keluar`] || 0), 0), 0)}
                    </td>
                    <td className="border px-2 py-2.5 text-center text-sm font-bold" style={{ borderColor: "var(--pp-ink)", color: "#b45309" }}>
                      {TIPE_OPTIONS.reduce((s, t) => s + KESULITAN_OPTIONS.reduce((ss, k) => ss + (totals[`${t}_${k}_bank`] || 0), 0), 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

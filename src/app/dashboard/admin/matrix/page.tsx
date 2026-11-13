"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Trash2, LockOpen, Users } from "lucide-react"
import ThemeToggle from "@/components/ThemeToggle"
import Toast from "@/components/Toast"
import { supabase } from "@/lib/supabase"
import { labelUjian, type UjianPsat } from "@/lib/ujian"

interface MatrixBab {
  profile_id: string
  bab_id_text: string
  is_submitted: boolean
}

interface GuruGroup {
  key: string           // profile_id + ujian_id
  profile_id: string
  ujian_id: string | null
  nama: string
  email: string
  mapel_nama: string
  babs: MatrixBab[]
}

interface Siklus {
  event_id: string
  event_nama: string
  tahun_ajaran: string | null
  semester: number | null
  event_aktif: boolean
  ujian: UjianPsat[]
}

export default function AdminMatrixPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<GuruGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMatrix, setLoadingMatrix] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState<string | null>(null)
  const [siklusList, setSiklusList] = useState<Siklus[]>([])
  const [selectedEventId, setSelectedEventId] = useState("")
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      // Filter siklus ini khusus admin. RLS tetap menjadi penjaga terakhir,
      // tetapi halaman admin tidak boleh bergantung pada URL saja.
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
      if (!profile || profile.role !== "admin") {
        router.push("/dashboard")
        return
      }

      // get_ujian_psat sengaja lintas event: di sini daftar event itulah yang
      // menjadi pilihan filter siklus. Urutannya sudah tahun terbaru dulu.
      const { data: ujianData, error } = await supabase.rpc("get_ujian_psat")
      if (error) {
        console.error("Gagal memuat daftar siklus:", error)
        setLoading(false)
        return
      }
      const semuaUjian = (ujianData as UjianPsat[]) ?? []

      const byEvent = new Map<string, Siklus>()
      for (const u of semuaUjian) {
        if (!u.event_id) continue
        let siklus = byEvent.get(u.event_id)
        if (!siklus) {
          siklus = {
            event_id: u.event_id,
            event_nama: u.event_nama || "-",
            tahun_ajaran: u.tahun_ajaran,
            semester: u.semester,
            event_aktif: u.event_aktif,
            ujian: [],
          }
          byEvent.set(u.event_id, siklus)
        }
        siklus.ujian.push(u)
      }

      const list = [...byEvent.values()]
      list.sort((a, b) => {
        if (a.event_aktif !== b.event_aktif) return a.event_aktif ? -1 : 1
        const byYear = (b.tahun_ajaran || "").localeCompare(a.tahun_ajaran || "")
        if (byYear !== 0) return byYear
        const bySemester = (b.semester || 0) - (a.semester || 0)
        if (bySemester !== 0) return bySemester
        return a.event_nama.localeCompare(b.event_nama)
      })
      const aktif = list.find(s => s.event_aktif)
      const defaultEvent = aktif ?? list[0]
      setSiklusList(list)
      setSelectedEventId(defaultEvent?.event_id ?? "")
      setLoadingMatrix(!!defaultEvent)
      setLoading(false)
    }
    load()
  }, [router])

  useEffect(() => {
    if (!selectedEventId) return
    const siklus = siklusList.find(s => s.event_id === selectedEventId)
    if (!siklus) return

    const ujianList = siklus.ujian
    let cancelled = false

    async function loadMatrix() {
      setLoadingMatrix(true)
      const ujianIds = ujianList.map(u => u.ujian_id)

      if (ujianIds.length === 0) {
        if (!cancelled) { setGroups([]); setLoadingMatrix(false) }
        return
      }

      const { data: matrixRows } = await supabase
        .from("psat_matrix_input")
        .select("profile_id, ujian_id, bab_id_text, is_submitted")
        .in("ujian_id", ujianIds)
        .order("profile_id")

      if (cancelled) return
      if (!matrixRows || matrixRows.length === 0) {
        setGroups([])
        setLoadingMatrix(false)
        return
      }

      const profileIds = [...new Set(matrixRows.map(r => r.profile_id))]
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nama, email")
        .in("id", profileIds)

      if (cancelled) return

      const profileMap: Record<string, { nama: string; email: string }> = {}
      profiles?.forEach(p => { profileMap[p.id] = { nama: p.nama || p.email || "Unknown", email: p.email || "" } })

      const ujianMap: Record<string, string> = {}
      ujianList.forEach(u => { ujianMap[u.ujian_id] = labelUjian(u) })

      // Satu guru bisa punya matrix di lebih dari satu ujian, jadi dikelompokkan
      // per (guru × ujian) — bukan per guru saja seperti sebelumnya.
      const groupMap: Record<string, GuruGroup> = {}
      matrixRows.forEach(row => {
        const key = `${row.profile_id}|${row.ujian_id ?? "-"}`
        if (!groupMap[key]) {
          const profile = profileMap[row.profile_id] || { nama: "Unknown", email: "" }
          groupMap[key] = {
            key,
            profile_id: row.profile_id,
            ujian_id: row.ujian_id ?? null,
            nama: profile.nama,
            email: profile.email,
            mapel_nama: row.ujian_id ? (ujianMap[row.ujian_id] || "-") : "-",
            babs: [],
          }
        }
        groupMap[key].babs.push({
          profile_id: row.profile_id,
          bab_id_text: row.bab_id_text,
          is_submitted: row.is_submitted,
        })
      })

      setGroups(Object.values(groupMap))
      setLoadingMatrix(false)
    }

    loadMatrix()
    return () => { cancelled = true }
  }, [selectedEventId, siklusList])

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Semua aksi di bawah dibatasi ke satu ujian. Tanpa itu, membuka kunci
  // matrix Matematika kelas 7 ikut membuka matrix kelas 8 milik guru yang sama.
  const handleDeleteBab = async (group: GuruGroup, babIdText: string) => {
    if (!confirm(`Hapus bab "${babIdText}" pada ${group.mapel_nama}?`)) return
    setDeleting(`${group.key}:${babIdText}`)
    let q = supabase.from("psat_matrix_input").delete()
      .eq("profile_id", group.profile_id)
      .eq("bab_id_text", babIdText)
    q = group.ujian_id ? q.eq("ujian_id", group.ujian_id) : q.is("ujian_id", null)
    const { error } = await q
    if (error) {
      showToast("Error: " + error.message, "error")
    } else {
      setGroups(prev =>
        prev
          .map(g => g.key === group.key ? { ...g, babs: g.babs.filter(b => b.bab_id_text !== babIdText) } : g)
          .filter(g => g.babs.length > 0)
      )
      showToast(`Bab "${babIdText}" dihapus`, "success")
    }
    setDeleting(null)
  }

  const handleDeleteGuru = async (group: GuruGroup) => {
    if (!confirm(`Hapus SEMUA matrix "${group.nama}" untuk ${group.mapel_nama}? Tindakan ini tidak dapat dibatalkan.`)) return
    setDeleting(group.key)
    let q = supabase.from("psat_matrix_input").delete().eq("profile_id", group.profile_id)
    q = group.ujian_id ? q.eq("ujian_id", group.ujian_id) : q.is("ujian_id", null)
    const { error } = await q
    if (error) {
      showToast("Error: " + error.message, "error")
    } else {
      setGroups(prev => prev.filter(g => g.key !== group.key))
      showToast(`Matrix ${group.nama} — ${group.mapel_nama} dihapus`, "success")
    }
    setDeleting(null)
  }

  const handleUnlockGuru = async (group: GuruGroup) => {
    if (!confirm(`Buka kunci edit matrix "${group.nama}" untuk ${group.mapel_nama}?`)) return
    setUnlocking(group.key)
    let q = supabase.from("psat_matrix_input").update({ is_submitted: false })
      .eq("profile_id", group.profile_id)
    q = group.ujian_id ? q.eq("ujian_id", group.ujian_id) : q.is("ujian_id", null)
    const { error } = await q
    if (error) {
      showToast("Error: " + error.message, "error")
    } else {
      setGroups(prev => prev.map(g =>
        g.key === group.key ? { ...g, babs: g.babs.map(b => ({ ...b, is_submitted: false })) } : g
      ))
      showToast(`Matrix ${group.nama} — ${group.mapel_nama} dibuka untuk diedit ulang`, "success")
    }
    setUnlocking(null)
  }

  if (loading) {
    return (
      <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }} className="flex items-center justify-center">
        <div className="font-display text-xl" style={{ color: "var(--pp-ink-2)" }}>Memuat...</div>
      </div>
    )
  }

  const siklusTerpilih = siklusList.find(s => s.event_id === selectedEventId)

  return (
    <div style={{ backgroundColor: "var(--pp-bg)", minHeight: "100vh" }}>
      <header
        className="sticky top-0 z-10"
        style={{ backgroundColor: "var(--pp-card)", borderBottom: "1.5px solid var(--pp-ink)" }}
      >
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div style={{
              width: 40, height: 40, flexShrink: 0,
              backgroundColor: "var(--pp-primary)",
              border: "1.5px dashed rgba(255,255,255,0.45)",
              borderRadius: 12,
              boxShadow: "2px 2px 0 0 var(--pp-ink)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Users className="w-4 h-4 text-white" />
            </div>
            <div className="font-display font-semibold text-base" style={{ color: "var(--pp-ink)" }}>
              Kelola Matrix Guru
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-4 pb-1 flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
          style={{ color: "var(--pp-muted)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Dashboard
        </button>
        {siklusList.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor="filter-siklus" className="text-xs font-semibold" style={{ color: "var(--pp-muted)" }}>
              Siklus:
            </label>
            <select
              id="filter-siklus"
              value={selectedEventId}
              onChange={e => setSelectedEventId(e.target.value)}
              className="text-xs font-semibold px-3 py-2 rounded-xl"
              style={{
                backgroundColor: "var(--pp-card)",
                border: "1.5px solid var(--pp-ink)",
                color: "var(--pp-ink)",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {siklusList.map(s => (
                <option key={s.event_id} value={s.event_id}>
                  {s.event_nama} · {s.tahun_ajaran}{s.event_aktif ? " (Aktif)" : ""}
                </option>
              ))}
            </select>
            {siklusTerpilih && !siklusTerpilih.event_aktif && (
              <span
                className="text-xs font-semibold px-2 py-1 rounded-full"
                style={{ backgroundColor: "var(--pp-lemon)", color: "var(--pp-ink)", border: "1px solid var(--pp-ink)" }}
              >
                Arsip
              </span>
            )}
          </div>
        )}
      </div>

      <main className="max-w-4xl mx-auto px-4 py-4 pb-12 space-y-4">
        {loadingMatrix ? (
          <div
            style={{
              backgroundColor: "var(--pp-card)",
              border: "1.5px solid var(--pp-ink)",
              borderRadius: 22,
              boxShadow: "4px 4px 0 0 var(--pp-ink)",
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <p className="font-display font-semibold" style={{ color: "var(--pp-ink)" }}>Memuat matrix...</p>
            <p className="text-sm mt-1" style={{ color: "var(--pp-muted)" }}>Mengambil data untuk siklus yang dipilih.</p>
          </div>
        ) : groups.length === 0 ? (
          <div
            style={{
              backgroundColor: "var(--pp-card)",
              border: "1.5px solid var(--pp-ink)",
              borderRadius: 22,
              boxShadow: "4px 4px 0 0 var(--pp-ink)",
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <div style={{
              width: 52, height: 52,
              backgroundColor: "var(--pp-bg)",
              border: "1.5px solid var(--pp-ink)",
              borderRadius: 16,
              boxShadow: "2px 2px 0 0 var(--pp-ink)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <Users className="w-6 h-6" style={{ color: "var(--pp-muted)" }} />
            </div>
            <p className="font-display font-semibold" style={{ color: "var(--pp-ink)" }}>Belum Ada Data Matrix</p>
            <p className="text-sm mt-1" style={{ color: "var(--pp-muted)" }}>Belum ada matrix yang dikirimkan oleh guru pada siklus ini.</p>
          </div>
        ) : (
          groups.map(group => {
            const submittedCount = group.babs.filter(b => b.is_submitted).length
            return (
              <div
                key={group.key}
                style={{
                  backgroundColor: "var(--pp-card)",
                  border: "1.5px solid var(--pp-ink)",
                  borderRadius: 22,
                  boxShadow: "4px 4px 0 0 var(--pp-ink)",
                  overflow: "hidden",
                }}
              >
                {/* Guru header band */}
                <div style={{
                  backgroundColor: "#FFF0E6",
                  borderBottom: "1.5px solid var(--pp-ink)",
                  padding: "14px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap" as const,
                }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div style={{
                      width: 38, height: 38, flexShrink: 0,
                      backgroundColor: "var(--pp-card)",
                      border: "1.5px solid var(--pp-ink)",
                      borderRadius: 10,
                      boxShadow: "2px 2px 0 0 var(--pp-ink)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <span className="font-display font-bold text-sm" style={{ color: "#c2410c" }}>
                        {group.nama.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="font-display font-semibold text-sm" style={{ color: "var(--pp-ink)" }}>{group.nama}</div>
                      <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap" style={{ color: "var(--pp-muted)" }}>
                        {group.email}
                        <span
                          className="px-1.5 py-0.5 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: "var(--pp-peach)", color: "#c2410c", border: "1px solid var(--pp-ink)" }}
                        >
                          {group.mapel_nama}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: "var(--pp-mint)", color: "#15803d", border: "1.5px solid var(--pp-ink)" }}
                    >
                      {submittedCount}/{group.babs.length} submitted
                    </span>
                    {group.babs.some(b => b.is_submitted) && (
                      <button
                        onClick={() => handleUnlockGuru(group)}
                        disabled={unlocking === group.key}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                        style={{
                          backgroundColor: "var(--pp-lemon)",
                          color: "#92400e",
                          border: "1.5px solid var(--pp-ink)",
                          boxShadow: "2px 2px 0 0 var(--pp-ink)",
                        }}
                      >
                        <LockOpen className="w-3 h-3" />
                        Buka Kunci
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteGuru(group)}
                      disabled={deleting === group.key}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                      style={{
                        backgroundColor: "var(--pp-pink)",
                        color: "#be123c",
                        border: "1.5px solid var(--pp-ink)",
                        boxShadow: "2px 2px 0 0 var(--pp-ink)",
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Hapus Semua
                    </button>
                  </div>
                </div>

                {/* Bab list */}
                <div style={{ padding: "16px 20px" }} className="space-y-2">
                  {group.babs.map((bab, bi) => {
                    const key = `${group.key}:${bab.bab_id_text}`
                    return (
                      <div
                        key={bab.bab_id_text}
                        className="flex items-center justify-between px-4 py-2.5 rounded-[12px]"
                        style={{
                          backgroundColor: bi % 2 === 0 ? "var(--pp-bg)" : "var(--pp-card)",
                          border: "1.5px solid var(--pp-line)",
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                            style={{ backgroundColor: "var(--pp-lemon)", color: "var(--pp-ink)", border: "1px solid var(--pp-ink)" }}
                          >
                            {bi + 1}
                          </div>
                          <span className="text-sm font-medium" style={{ color: "var(--pp-ink)" }}>
                            {bab.bab_id_text}
                          </span>
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{
                              backgroundColor: bab.is_submitted ? "var(--pp-mint)" : "var(--pp-bg)",
                              color: bab.is_submitted ? "#15803d" : "var(--pp-muted)",
                              border: "1px solid var(--pp-line)",
                            }}
                          >
                            {bab.is_submitted ? "Submitted" : "Draft"}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteBab(group, bab.bab_id_text)}
                          disabled={deleting === key}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                          style={{
                            backgroundColor: "var(--pp-pink)",
                            color: "#be123c",
                            border: "1.5px solid var(--pp-ink)",
                            boxShadow: "1px 1px 0 0 var(--pp-ink)",
                          }}
                          title="Hapus bab ini"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

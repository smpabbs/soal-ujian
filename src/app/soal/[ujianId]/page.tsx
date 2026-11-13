import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { MathHtml } from "@/components/MathHtml"
import { ArrowLeft, BookOpen, FileQuestion } from "lucide-react"
import { labelUjian, KESULITAN_LABELS, KESULITAN_LABELS_PANJANG, type UjianPsat } from "@/lib/ujian"

export const revalidate = 300

interface Soal {
  id: string
  pertanyaan: string
  tipe: string
  tingkat_kesulitan: string
  bab_id_text: string
}

const TIPE_LABEL: Record<string, string> = {
  pilgan: "Pilihan Ganda",
  ceklist: "Ceklist",
  essay: "Essay",
  isian_singkat: "Isian Singkat",
  benar_salah: "Benar/Salah",
}

const KESULITAN_COLOR: Record<string, { bg: string; text: string }> = {
  mudah:  { bg: "#f0fdf4", text: "#15803d" },
  sedang: { bg: "#fef3c7", text: "#b45309" },
  sulit:  { bg: "#fef2f2", text: "#dc2626" },
}

export default async function PublikSoalPage({ params }: { params: Promise<{ ujianId: string }> }) {
  const { ujianId } = await params

  const ujianRes = await supabase.rpc("get_ujian_psat")
  const ujian = ((ujianRes.data as UjianPsat[]) ?? []).find(u => u.ujian_id === ujianId)

  // Halaman publik hanya untuk siklus aktif. Soal siklus lama tetap tersimpan,
  // tetapi tidak ditampilkan lewat tautan langsung saat siklus lain aktif.
  if (!ujian || !ujian.event_aktif) {
    return (
      <div style={{ backgroundColor: "var(--color-background)", minHeight: "100vh" }}>
        <header
          className="sticky top-0 z-10 border-b"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <ArrowLeft className="w-4 h-4" />
              Kembali
            </Link>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
              <h1 className="text-base font-bold" style={{ color: "var(--color-foreground)" }}>
                Daftar Soal
              </h1>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-8">
          <div
            className="rounded-lg border p-12 text-center"
            style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
          >
            <FileQuestion className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-muted-foreground)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
              Siklus ujian ini tidak aktif
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--color-muted-foreground)" }}>
              Soal hanya ditampilkan untuk siklus ujian yang sedang aktif.
            </p>
            <Link
              href="/"
              className="inline-block mt-4 text-sm font-semibold"
              style={{ color: "var(--color-primary)" }}
            >
              Kembali ke halaman utama
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const soalRes = await supabase.rpc("get_public_soal_by_ujian", { p_ujian_id: ujianId })
  const soalList: Soal[] = (soalRes.data as Soal[]) ?? []
  const mapelNama = labelUjian(ujian)

  // Group by bab
  const byBab: Record<string, Soal[]> = {}
  for (const s of soalList) {
    const bab = s.bab_id_text || "Tanpa Bab"
    if (!byBab[bab]) byBab[bab] = []
    byBab[bab].push(s)
  }

  return (
    <div style={{ backgroundColor: "var(--color-background)", minHeight: "100vh" }}>
      <header
        className="sticky top-0 z-10 border-b"
        style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
      >
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </Link>
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
            <h1 className="text-base font-bold" style={{ color: "var(--color-foreground)" }}>
              {mapelNama} — Daftar Soal
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {soalList.length === 0 ? (
          <div
            className="rounded-lg border p-12 text-center"
            style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
          >
            <FileQuestion className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-muted-foreground)" }} />
            <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              Belum ada soal yang diapprove untuk mata pelajaran ini.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              {soalList.length} soal approved
            </p>
            {Object.entries(byBab).map(([bab, soals]) => (
              <div
                key={bab}
                className="rounded-lg border overflow-hidden"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}
              >
                <div
                  className="px-4 py-2.5 border-b font-semibold text-sm"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)", backgroundColor: "var(--color-muted)" }}
                >
                  {bab}
                  <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-muted-foreground)" }}>
                    {soals.length} soal
                  </span>
                </div>
                <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                  {soals.map((s, idx) => {
                    const kesColor = KESULITAN_COLOR[s.tingkat_kesulitan] ?? { bg: "var(--color-muted)", text: "var(--color-muted-foreground)" }
                    return (
                      <div key={s.id} className="px-4 py-3 flex gap-3">
                        <span className="text-sm shrink-0 w-6 text-right" style={{ color: "var(--color-muted-foreground)" }}>
                          {idx + 1}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <MathHtml
                            className="text-sm mb-1.5 leading-relaxed rich-html"
                            style={{ color: "var(--color-foreground)" }}
                            html={s.pertanyaan}
                          />
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: "var(--color-muted)", color: "var(--color-muted-foreground)" }}
                            >
                              {TIPE_LABEL[s.tipe] ?? s.tipe}
                            </span>
                            {s.tingkat_kesulitan && (
                              <span
                                className="text-xs px-1.5 py-0.5 rounded"
                                title={KESULITAN_LABELS_PANJANG[s.tingkat_kesulitan]}
                                style={{ backgroundColor: kesColor.bg, color: kesColor.text }}
                              >
                                {KESULITAN_LABELS[s.tingkat_kesulitan] ?? s.tingkat_kesulitan}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

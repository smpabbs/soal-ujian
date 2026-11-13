import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { ArrowLeft, LayoutGrid, Inbox } from "lucide-react"
import { labelUjian, KESULITAN_OPTIONS, KESULITAN_LABELS, KESULITAN_LABELS_PANJANG, type UjianPsat } from "@/lib/ujian"

export const revalidate = 300

interface MatrixRow {
  bab_id_text: string
  data: Record<string, number>
}

const TIPE_OPTIONS = ["pilgan", "ceklist", "essay", "isian_singkat", "benar_salah", "pilgan_kategori"]

export default async function PublikMatrixPage({ params }: { params: Promise<{ ujianId: string; profileId: string }> }) {
  const { ujianId, profileId } = await params

  const ujianRes = await supabase.rpc("get_ujian_psat")
  const ujian = ((ujianRes.data as UjianPsat[]) ?? []).find(u => u.ujian_id === ujianId)

  // Halaman publik hanya untuk siklus aktif. Matrix siklus lama tetap tersimpan,
  // tetapi tidak ditampilkan lewat tautan langsung saat siklus lain aktif.
  if (!ujian || !ujian.event_aktif) {
    return (
      <div style={{ backgroundColor: "var(--color-background)", minHeight: "100vh" }}>
        <header
          className="sticky top-0 z-10 border-b"
          style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
        >
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <ArrowLeft className="w-4 h-4" />
              Kembali
            </Link>
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
              <h1 className="text-base font-bold" style={{ color: "var(--color-foreground)" }}>
                Matrix Soal
              </h1>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8">
          <div
            className="rounded-lg border p-12 text-center"
            style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
          >
            <Inbox className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-muted-foreground)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
              Siklus ujian ini tidak aktif
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--color-muted-foreground)" }}>
              Matrix hanya ditampilkan untuk siklus ujian yang sedang aktif.
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

  const matrixRes = await supabase.rpc("get_public_matrix_by_ujian", { p_ujian_id: ujianId, p_profile_id: profileId })
  const matrixRows: MatrixRow[] = (matrixRes.data as MatrixRow[]) ?? []
  const mapelNama = labelUjian(ujian)

  return (
    <div style={{ backgroundColor: "var(--color-background)", minHeight: "100vh" }}>
      <header
        className="sticky top-0 z-10 border-b"
        style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
      >
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </Link>
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
            <h1 className="text-base font-bold" style={{ color: "var(--color-foreground)" }}>
              {mapelNama} — Matrix Soal
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {matrixRows.length === 0 ? (
          <div
            className="rounded-lg border p-12 text-center"
            style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}
          >
            <Inbox className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--color-muted-foreground)" }} />
            <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
              Belum ada matrix yang disubmit untuk akun ini.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {matrixRows.map((row) => (
              <div
                key={row.bab_id_text}
                className="rounded-lg border overflow-hidden"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}
              >
                <div
                  className="px-4 py-2.5 border-b font-semibold text-sm"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)", backgroundColor: "var(--color-muted)" }}
                >
                  {row.bab_id_text}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <th className="px-3 py-2 text-left font-medium" style={{ color: "var(--color-muted-foreground)" }}>Tipe</th>
                        {KESULITAN_OPTIONS.map(k => (
                          <th key={k} colSpan={2} className="px-3 py-2 text-center font-medium" title={KESULITAN_LABELS_PANJANG[k]} style={{ color: "var(--color-muted-foreground)" }}>
                            {KESULITAN_LABELS[k] ?? k}
                          </th>
                        ))}
                      </tr>
                      <tr style={{ borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-muted)" }}>
                        <th className="px-3 py-2" />
                        {KESULITAN_OPTIONS.flatMap(k => [
                          <th key={`${k}-keluar`} className="px-3 py-1.5 text-center text-xs font-medium" style={{ color: "var(--color-muted-foreground)" }}>Keluar</th>,
                          <th key={`${k}-bank`} className="px-3 py-1.5 text-center text-xs font-medium" style={{ color: "var(--color-muted-foreground)" }}>Bank</th>,
                        ])}
                      </tr>
                    </thead>
                    <tbody>
                      {TIPE_OPTIONS.map((tipe, ti) => (
                        <tr
                          key={tipe}
                          style={{ borderBottom: ti < TIPE_OPTIONS.length - 1 ? "1px solid var(--color-border)" : undefined }}
                        >
                          <td className="px-3 py-2.5 font-medium capitalize" style={{ color: "var(--color-foreground)" }}>
                            {tipe}
                          </td>
                          {KESULITAN_OPTIONS.flatMap(kesulitan => {
                            const keluar = row.data?.[`${tipe}_${kesulitan}_keluar`] ?? 0
                            const bank   = row.data?.[`${tipe}_${kesulitan}_bank`]   ?? 0
                            return [
                              <td key={`${kesulitan}-keluar`} className="px-3 py-2.5 text-center" style={{ color: keluar > 0 ? "#15803d" : "var(--color-muted-foreground)" }}>
                                {keluar}
                              </td>,
                              <td key={`${kesulitan}-bank`} className="px-3 py-2.5 text-center" style={{ color: bank > 0 ? "var(--color-foreground)" : "var(--color-muted-foreground)" }}>
                                {bank}
                              </td>,
                            ]
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-muted-foreground)" }}>
                  Keluar = soal yang tampil di ujian · Bank = total soal yang disiapkan
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

"use client"

import { Check } from "lucide-react"
import { MathHtml } from "@/components/MathHtml"
import { KESULITAN_LABELS, type BarisRubrik } from "@/lib/ujian"

/**
 * Pratinjau satu soal apa adanya — pertanyaan, pilihan, kunci jawaban, rubrik.
 *
 * Dipakai layar komentar, yang boleh berisi soal milik guru lain dan semua
 * status (termasuk draft & approved). Di luar itu tampilannya sengaja sama
 * dengan daftar soal di halaman penulis supaya tidak ada dua "bahasa" soal di
 * aplikasi yang sama.
 */

const TIPE_LABELS: Record<string, string> = {
  pilgan: "Pilgan",
  ceklist: "Ceklist",
  essay: "Essay",
  isian_singkat: "Isian Singkat",
  benar_salah: "Benar/Salah",
  pilgan_kategori: "Pilgan Berkategori",
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:          { bg: "var(--pp-bg)",    text: "var(--pp-muted)", label: "Draft" },
  submitted:      { bg: "var(--pp-lemon)", text: "var(--pp-ink)",   label: "Dikirim" },
  approved:       { bg: "var(--pp-mint)",  text: "var(--pp-ink)",   label: "Approved" },
  needs_revision: { bg: "var(--pp-pink)",  text: "var(--pp-ink)",   label: "Revisi" },
}

const KESULITAN_COLORS: Record<string, { bg: string; text: string }> = {
  mudah:  { bg: "#d1fae5", text: "#065f46" },
  sedang: { bg: "#fef9c3", text: "#854d0e" },
  sulit:  { bg: "#fee2e2", text: "#991b1b" },
}

export interface SoalPratinjau {
  pertanyaan: string
  gambar_url?: string | null
  tipe: string
  tingkat_kesulitan: string
  status?: string | null
  bobot?: number | null
  pilihan?: { id: number; teks: string; benar?: boolean }[] | null
  pilihan_gambar?: string[] | null
  jawaban_benar?: unknown
  rubrik?: BarisRubrik[] | null
}

/** Kunci isian singkat bisa tersimpan sebagai larik alternatif atau satu kata. */
function bacaKunci(nilai: unknown): string[] {
  if (Array.isArray(nilai)) return nilai.map(v => String(v)).filter(Boolean)
  if (typeof nilai === "string" && nilai.trim()) return [nilai.trim()]
  return []
}

export default function SoalKartu({
  soal,
  nomor,
  penulis,
  meta,
}: {
  soal: SoalPratinjau
  nomor?: number
  penulis?: string | null
  /** Baris kecil di bawah nomor, mis. nama bab atau nama ujian. */
  meta?: string | null
}) {
  const tipe = TIPE_LABELS[soal.tipe] || soal.tipe
  const status = soal.status ? STATUS_STYLES[soal.status] ?? STATUS_STYLES.draft : null
  const kes = KESULITAN_COLORS[soal.tingkat_kesulitan] ?? KESULITAN_COLORS.mudah
  const kunciTeks = bacaKunci(soal.jawaban_benar)
  const benarSalahTipe = soal.tipe === "isian_singkat"

  return (
    <div className="text-sm" style={{ color: "var(--pp-ink)" }}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {typeof nomor === "number" && (
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-display"
            style={{ backgroundColor: "var(--pp-lemon)", color: "var(--pp-ink)", border: "1.5px solid var(--pp-ink)" }}
          >
            {nomor}
          </span>
        )}
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: "var(--pp-bg)", color: "var(--pp-ink-2)", border: "1px solid var(--pp-line)" }}>
          {tipe}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: kes.bg, color: kes.text, border: "1px solid var(--pp-ink)" }}>
          {KESULITAN_LABELS[soal.tingkat_kesulitan] ?? soal.tingkat_kesulitan}
        </span>
        {status && (
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: status.bg, color: status.text, border: "1px solid var(--pp-line)" }}>
            {status.label}
          </span>
        )}
        {soal.bobot != null && (
          <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--pp-bg)", color: "var(--pp-ink-2)", border: "1px solid var(--pp-line)" }}>
            Bobot: {soal.bobot}
          </span>
        )}
        {(penulis || meta) && (
          <span className="text-xs ml-auto truncate" style={{ color: "var(--pp-muted)" }}>
            {[penulis, meta].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      <MathHtml className="rich-html" html={soal.pertanyaan} />

      {soal.gambar_url && (
        <img
          src={soal.gambar_url}
          alt="Gambar soal"
          style={{ maxWidth: 260, maxHeight: 180, marginTop: 8, borderRadius: 8, objectFit: "contain" }}
        />
      )}

      {soal.pilihan && soal.pilihan.length > 0 && (
        <div className="mt-2 space-y-1">
          {soal.pilihan.map((p, i) => {
            const gambar = soal.pilihan_gambar?.[p.id] || ""
            const isBenar = !!p.benar
            return (
              <div
                key={p.id ?? i}
                className="flex items-start gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
                style={{
                  backgroundColor: isBenar ? "#f0fdf4" : "var(--pp-bg)",
                  border: `1px solid ${isBenar ? "#86efac" : "var(--pp-line)"}`,
                }}
              >
                <span className="font-bold flex-shrink-0 mt-0.5" style={{ color: isBenar ? "#15803d" : "var(--pp-muted)" }}>
                  {String.fromCharCode(65 + i)}.
                </span>
                <div className="flex-1 min-w-0">
                  {p.teks && (
                    <MathHtml className="rich-html" style={{ color: isBenar ? "#15803d" : "var(--pp-ink)" }} html={p.teks} />
                  )}
                  {gambar && (
                    <img
                      src={gambar}
                      alt={`Pilihan ${String.fromCharCode(65 + i)}`}
                      style={{ maxWidth: 160, maxHeight: 100, marginTop: p.teks ? 4 : 0, borderRadius: 6, objectFit: "contain" }}
                    />
                  )}
                </div>
                {isBenar && <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "#15803d" }} />}
              </div>
            )
          })}
        </div>
      )}

      {/* Kunci isian singkat tidak punya baris pilihan — tampilkan terpisah. */}
      {benarSalahTipe && kunciTeks.length > 0 && (
        <div className="mt-2 text-xs px-2.5 py-1.5 rounded-lg"
             style={{ backgroundColor: "#f0fdf4", border: "1px solid #86efac", color: "#15803d" }}>
          <span className="font-semibold">Kunci:</span> {kunciTeks.join(" / ")}
        </div>
      )}

      {/* Rubrik hanya ada untuk tipe yang dinilai manusia. */}
      {soal.rubrik && soal.rubrik.length > 0 && (
        <div className="mt-2 text-xs px-2.5 py-2 rounded-lg"
             style={{ backgroundColor: "var(--pp-bg)", border: "1px solid var(--pp-line)" }}>
          <div className="font-semibold mb-1" style={{ color: "var(--pp-ink-2)" }}>Rubrik penilaian</div>
          <ul className="space-y-0.5">
            {soal.rubrik.map((r, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span style={{ color: "var(--pp-ink)" }}>{r.kriteria}</span>
                <span className="font-semibold shrink-0" style={{ color: "var(--pp-ink-2)" }}>{r.poin}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

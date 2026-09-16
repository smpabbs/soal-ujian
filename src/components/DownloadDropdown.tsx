"use client"

import React, { useEffect, useRef, useState } from 'react'
import { Download, ChevronDown, FileText, FileJson, FileCode } from 'lucide-react'
import type { SoalDownload, PdfMeta } from '@/lib/downloadSoal'

interface Props {
  soalList: SoalDownload[]
  filename: string
  meta: PdfMeta
  disabled?: boolean
  googleFormsSoalList?: SoalDownload[]
}

export default function DownloadDropdown({ soalList, filename, meta, disabled, googleFormsSoalList }: Props) {
  const [open, setOpen] = useState(false)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleJson = () => {
    setOpen(false)
    setErrorMsg(null)
    import('@/lib/downloadSoal')
      .then(({ downloadJSON }) => downloadJSON(soalList, filename))
      .catch(e => {
        console.error('JSON generation error:', e)
        setErrorMsg('Gagal membuat JSON: ' + (e instanceof Error ? e.message : String(e)))
      })
  }

  const handleGoogleForms = async () => {
    setOpen(false)
    setErrorMsg(null)
    try {
      const { generateGoogleFormsScript } = await import('@/lib/downloadSoal')
      await generateGoogleFormsScript(googleFormsSoalList ?? soalList, meta.judul)
    } catch (e) {
      console.error('Google Forms script error:', e)
      setErrorMsg('Gagal membuat script: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const handlePdf = async () => {
    setOpen(false)
    setErrorMsg(null)
    setLoadingPdf(true)
    try {
      const [{ processSoal, convertImageToJpegDataUrl }, { pdf }, { default: SoalPdfDocument }] = await Promise.all([
        import('@/lib/downloadSoal'),
        import('@react-pdf/renderer'),
        import('@/components/SoalPdfDocument'),
      ])
      const processed = processSoal(soalList)

      // Konversi semua gambar ke JPEG data URL agar react-pdf bisa render
      const processedWithImages = await Promise.all(
        processed.map(async soal => ({
          ...soal,
          pertanyaan_images: (await Promise.all(
            soal.pertanyaan_images.map(url => convertImageToJpegDataUrl(url))
          )).filter((u): u is string => u !== null),
        }))
      )

      const blob = await pdf(
        React.createElement(SoalPdfDocument, { soalList: processedWithImages, meta }) as React.ReactElement<any>
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('PDF generation error:', e)
      setErrorMsg('Gagal membuat PDF: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoadingPdf(false)
    }
  }

  const isDisabled = disabled || soalList.length === 0 || loadingPdf

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => !isDisabled && setOpen(o => !o)}
        disabled={isDisabled}
        className="flex items-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium border"
        style={{
          backgroundColor: 'var(--color-card)',
          borderColor: 'var(--color-border)',
          color: isDisabled ? 'var(--color-muted-foreground)' : 'var(--color-foreground)',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.6 : 1,
        }}
      >
        <Download className="w-4 h-4" />
        {loadingPdf ? 'Membuat PDF...' : 'Download'}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          className="rounded-md border shadow-md py-1"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            minWidth: '160px',
            backgroundColor: 'var(--color-card)',
            borderColor: 'var(--color-border)',
          }}
        >
          <button
            onClick={handlePdf}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:opacity-70"
            style={{ color: 'var(--color-foreground)' }}
          >
            <FileText className="w-4 h-4 shrink-0" />
            Download PDF
          </button>
          <button
            onClick={handleJson}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:opacity-70"
            style={{ color: 'var(--color-foreground)' }}
          >
            <FileJson className="w-4 h-4 shrink-0" />
            Download JSON
          </button>
          <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '2px 8px' }} />
          <button
            onClick={handleGoogleForms}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:opacity-70"
            style={{ color: 'var(--color-foreground)' }}
          >
            <FileCode className="w-4 h-4 shrink-0" />
            Script Google Forms
          </button>
          <div className="px-3 pb-2 text-xs" style={{ color: 'var(--color-muted-foreground)', lineHeight: 1.4 }}>
            Download .gs → jalankan di<br />script.google.com
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          onClick={() => setErrorMsg(null)}
          className="rounded-md border px-3 py-2 text-xs shadow-md"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            minWidth: 220,
            maxWidth: 320,
            cursor: 'pointer',
            backgroundColor: '#fef2f2',
            borderColor: '#fecaca',
            color: '#991b1b',
            lineHeight: 1.4,
          }}
        >
          {errorMsg} (klik untuk tutup)
        </div>
      )}
    </div>
  )
}

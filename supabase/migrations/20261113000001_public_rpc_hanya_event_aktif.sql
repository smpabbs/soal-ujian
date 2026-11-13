-- =============================================================================
-- PSAT: RPC publik hanya untuk siklus ujian yang AKTIF
-- =============================================================================
-- Halaman publik sudah menyaring lewat get_ujian_psat().event_aktif, tetapi
-- RPC-nya sendiri masih bisa dipanggil langsung dengan ujian_id siklus lama.
-- Migrasi ini menutup celah itu di lapisan data: soal & matrix siklus nonaktif
-- tidak lagi dikembalikan, meskipun tautan langsungnya diketahui.
--
-- Data tetap tersimpan. Yang berubah hanya keterjangkauan publiknya.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION psat.get_public_soal_by_ujian(p_ujian_id UUID)
RETURNS TABLE (
  id                UUID,
  pertanyaan        TEXT,
  tipe              TEXT,
  tingkat_kesulitan TEXT,
  bab_id_text       TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = psat, public
AS $$
  SELECT bs.id, bs.pertanyaan, bs.tipe, bs.tingkat_kesulitan, bs.bab_id_text
  FROM psat.bank_soal bs
  JOIN public.ujian u       ON u.id = bs.ujian_id
  JOIN public.event_ujian ev ON ev.id = u.event_id AND ev.is_active
  WHERE bs.ujian_id = p_ujian_id
    AND bs.status = 'approved'
  ORDER BY bs.bab_id_text, bs.tipe, bs.tingkat_kesulitan, bs.created_at;
$$;

COMMENT ON FUNCTION psat.get_public_soal_by_ujian(UUID) IS
  'Soal approved untuk halaman publik. Hanya mengembalikan ujian dari event yang sedang aktif.';

CREATE OR REPLACE FUNCTION psat.get_public_matrix_by_ujian(p_ujian_id UUID, p_profile_id UUID)
RETURNS TABLE (
  bab_id_text TEXT,
  data        JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = psat, public
AS $$
  SELECT mi.bab_id_text, mi.data
  FROM psat.psat_matrix_input mi
  JOIN public.ujian u       ON u.id = mi.ujian_id
  JOIN public.event_ujian ev ON ev.id = u.event_id AND ev.is_active
  WHERE mi.ujian_id = p_ujian_id
    AND mi.profile_id = p_profile_id
    AND mi.is_submitted = true
  ORDER BY mi.bab_id_text;
$$;

COMMENT ON FUNCTION psat.get_public_matrix_by_ujian(UUID, UUID) IS
  'Matrix yang sudah disubmit untuk halaman publik. Hanya mengembalikan ujian dari event yang sedang aktif.';

COMMIT;

NOTIFY pgrst, 'reload schema';

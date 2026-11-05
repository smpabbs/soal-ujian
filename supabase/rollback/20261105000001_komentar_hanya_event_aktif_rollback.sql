-- Rollback: soal yang dikomentari kembali mencakup semua event
-- Pasangan: supabase/migrations/20261105000001_komentar_hanya_event_aktif.sql
--
-- ⚠️ Baris komentar tidak disentuh sama sekali. Rollback ini hanya mengembalikan
--    dua fungsi ke definisi 20261104000001 (tanpa saringan event).

BEGIN;

CREATE OR REPLACE FUNCTION psat.mapel_komentar_saya()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT x.id), '{}'::uuid[])
  FROM (
    SELECT COALESCE(ma.psat_mapel_id, gm.mapel_id) AS id
    FROM public.guru_mengajar gm
    LEFT JOIN psat.mapel_alias ma ON ma.public_mapel_id = gm.mapel_id
    WHERE gm.guru_id = auth.uid()
    UNION
    SELECT b.mata_pelajaran_id
    FROM psat.bank_soal b
    WHERE b.guru_id = auth.uid() AND b.mata_pelajaran_id IS NOT NULL
  ) x;
$fn$;

CREATE OR REPLACE FUNCTION psat.get_soal_komentator(p_mapel_id uuid)
RETURNS TABLE (
  id                uuid,
  mapel_id          uuid,
  mapel_nama        text,
  ujian_id          uuid,
  ujian_nama        text,
  penulis_id        uuid,
  penulis_nama      text,
  bab_id_text       text,
  tipe              text,
  tingkat_kesulitan text,
  status            text,
  bobot             numeric,
  pertanyaan        text,
  gambar_url        text,
  pilihan           jsonb,
  pilihan_gambar    text[],
  jawaban_benar     jsonb,
  rubrik            jsonb,
  created_at        timestamptz,
  jumlah_komentar   bigint,
  milik_saya        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
DECLARE
  v_staf boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi.' USING ERRCODE = '42501';
  END IF;

  SELECT (p.role = 'admin' OR p.is_soal_validator) INTO v_staf
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.status = 'aktif';

  IF NOT COALESCE(v_staf, false)
     AND NOT psat.saya_mengampu_mapel(p_mapel_id)
     AND NOT (p_mapel_id = ANY (psat.mapel_komentar_saya())) THEN
    RAISE EXCEPTION 'Anda tidak mengampu mata pelajaran ini.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.mata_pelajaran_id,
    mp.nama,
    b.ujian_id,
    u.nama,
    b.guru_id,
    COALESCE(psat.nama_pengguna(b.guru_id), 'Penulis'),
    b.bab_id_text,
    b.tipe,
    b.tingkat_kesulitan,
    b.status::text,
    b.bobot,
    b.pertanyaan,
    b.gambar_url,
    b.pilihan,
    b.pilihan_gambar,
    b.jawaban_benar,
    b.rubrik,
    b.created_at,
    (SELECT count(*) FROM psat.soal_komentar k WHERE k.soal_id = b.id),
    (b.guru_id = auth.uid())
  FROM psat.bank_soal b
  JOIN psat.mata_pelajaran mp ON mp.id = b.mata_pelajaran_id
  LEFT JOIN public.ujian u  ON u.id = b.ujian_id
  WHERE b.mata_pelajaran_id = p_mapel_id
  ORDER BY mp.nama, u.nama, b.created_at;
$fn$;

-- akses_saya() versi 20261104000001 (bisa_mengomentari dari daftar mapel).
CREATE OR REPLACE FUNCTION psat.akses_saya()
RETURNS TABLE (
  id             uuid,
  nama           text,
  email          text,
  role           text,
  bisa_menulis   boolean,
  bisa_memvalidasi boolean,
  bisa_mengomentari boolean,
  mapel_ids      uuid[],
  mapel_nama     text[],
  unit_sekolah   text,
  no_hp          text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
DECLARE
  v_id        uuid;
  v_nama      text;
  v_email     text;
  v_role_db   text;
  v_status    text;
  v_penulis   boolean;
  v_validator boolean;
  v_role      text;
  v_ids       uuid[];
  v_nama_mapel text[];
  v_unit      text;
  v_hp        text;
BEGIN
  SELECT p.id, p.nama, p.email, p.role, p.status, p.is_penulis_soal, p.is_soal_validator
    INTO v_id, v_nama, v_email, v_role_db, v_status, v_penulis, v_validator
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_status IS DISTINCT FROM 'aktif' THEN
    RETURN;
  END IF;

  v_role := CASE
              WHEN v_role_db = 'admin' THEN 'admin'
              WHEN v_validator         THEN 'validator'
              ELSE 'guru'
            END;

  IF v_role IN ('admin', 'validator') THEN
    SELECT array_agg(x.id ORDER BY x.nama), array_agg(x.nama ORDER BY x.nama)
      INTO v_ids, v_nama_mapel
    FROM (SELECT DISTINCT mp.id, mp.nama FROM psat.mata_pelajaran mp) x;
  ELSE
    SELECT array_agg(x.id ORDER BY x.nama), array_agg(x.nama ORDER BY x.nama)
      INTO v_ids, v_nama_mapel
    FROM (
      SELECT DISTINCT mp.id, mp.nama
      FROM psat.mata_pelajaran mp
      WHERE mp.id = ANY (psat.mapel_komentar_saya())
    ) x;
  END IF;

  IF v_role = 'guru'
     AND NOT COALESCE(v_penulis, false)
     AND COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  SELECT gd.unit_sekolah, gd.whatsapp INTO v_unit, v_hp
  FROM psat.psat_guru_data gd WHERE gd.profile_id = v_id;

  RETURN QUERY SELECT
    v_id,
    v_nama,
    v_email,
    v_role,
    (COALESCE(v_penulis, false) OR v_role IN ('admin', 'validator'))               AS bisa_menulis,
    (v_role IN ('admin', 'validator'))                                             AS bisa_memvalidasi,
    (v_role IN ('admin', 'validator')
       OR COALESCE(v_penulis, false)
       OR COALESCE(array_length(v_ids, 1), 0) > 0)                                 AS bisa_mengomentari,
    COALESCE(v_ids, '{}'::uuid[])                                                  AS mapel_ids,
    COALESCE(v_nama_mapel, '{}'::text[])                                           AS mapel_nama,
    v_unit                                                                         AS unit_sekolah,
    v_hp                                                                           AS no_hp;
END
$fn$;

COMMIT;

NOTIFY pgrst, 'reload schema';

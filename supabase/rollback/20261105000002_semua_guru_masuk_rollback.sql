-- Rollback: gerbang masuk kembali menolak guru tanpa penugasan
-- Pasangan: supabase/migrations/20261105000002_semua_guru_masuk.sql
--
-- ⚠️ Setelah rollback, guru tanpa penugasan & tanpa soal kembali berhenti di
--    layar "Akun Anda belum diberi akses" — perilaku sebelum 5 Nov 2026.

BEGIN;

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
  v_ampu      boolean;
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

  v_ampu := EXISTS (
    SELECT 1 FROM public.guru_mengajar gm WHERE gm.guru_id = v_id
  );

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

  -- Gerbang lama: guru tanpa penugasan, tanpa flag, dan tanpa mapel ditolak.
  IF v_role = 'guru'
     AND NOT COALESCE(v_penulis, false)
     AND NOT v_ampu
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
       OR v_ampu)                                                                  AS bisa_mengomentari,
    COALESCE(v_ids, '{}'::uuid[])                                                  AS mapel_ids,
    COALESCE(v_nama_mapel, '{}'::text[])                                           AS mapel_nama,
    v_unit                                                                         AS unit_sekolah,
    v_hp                                                                           AS no_hp;
END
$fn$;

COMMIT;

NOTIFY pgrst, 'reload schema';

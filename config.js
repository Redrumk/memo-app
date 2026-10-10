// Supabase 프로젝트 정보를 넣으면 로그인, 기기 간 동기화, 폴더 공유가 켜집니다.
// 비워두면 이 브라우저에만 저장하는 로컬 모드로 동작합니다.
// anon key는 공개용 키라 GitHub에 올려도 됩니다. 데이터 보호는 supabase/schema.sql 의 RLS 정책이 담당합니다.
export const CONFIG = {
  supabaseUrl: '',      // 예: 'https://abcdefgh.supabase.co'
  supabaseAnonKey: '',  // Supabase > Project Settings > API > anon public key
};

import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/analytics', permanent: false },
});

export default function AdminLoginPage() {
  return null;
}

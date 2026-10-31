import { notFound } from 'next/navigation';

import { ProfileGallery } from '@/components/profile/profile-gallery';

/**
 * `/profile/[id]/gallery` — the photos this person has posted.
 *
 * Same id guard as the profile page: a non-numeric segment is a 404 from Next,
 * never a request. The grid is a client component for the usual reason — the
 * read carries the in-memory access token and the backend decides visibility, so
 * a private account answers 403 rather than Next guessing.
 */
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const userId = Number(id);

  if (!Number.isInteger(userId) || userId <= 0) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <ProfileGallery userId={userId} />
    </div>
  );
}

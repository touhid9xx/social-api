import { notFound } from 'next/navigation';

import { FollowList } from '@/components/profile/follow-list';

/**
 * `/profile/[id]/followers` — who follows this person.
 *
 * Same id guard as the profile page: a non-numeric segment is a 404 from Next,
 * never a request. The list itself is a client component because the read
 * carries the in-memory access token and the backend decides visibility
 * (a private account answers 403 for everyone but its owner).
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
      <FollowList userId={userId} kind="followers" />
    </div>
  );
}

import { notFound } from 'next/navigation';

import { FollowList } from '@/components/profile/follow-list';

/**
 * `/profile/[id]/following` — who this person follows.
 *
 * The mirror of the followers route; both render `FollowList` with a different
 * `kind`, because the backend serialises both ends of the graph identically.
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
      <FollowList userId={userId} kind="following" />
    </div>
  );
}

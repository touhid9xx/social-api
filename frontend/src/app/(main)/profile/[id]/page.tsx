import { notFound } from 'next/navigation';

import { ProfilePage } from '@/components/profile/profile-page';

/**
 * `/profile/[id]` — a public profile and their posts.
 *
 * The segment is an **id**, not a username: `GET /api/v1/users/{user_id}` is the
 * only public profile route the backend exposes, and posts are keyed by
 * `author_id`. A `/profile/[username]` slug would have to be translated into an
 * id client-side with no endpoint to translate it.
 *
 * The id is validated here, on the server, for the same reason `/posts/[id]`
 * does it: `Number('12abc')` is NaN, `'1.5'` is not a user id, and `/profile/0`
 * cannot exist. A malformed id becomes Next's 404 instead of a backend request
 * that can only fail.
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
      <ProfilePage userId={userId} />
    </div>
  );
}

import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
        <div className="mb-2 text-lg font-bold">Link invalid or expired</div>
        <p className="mb-4 text-sm text-muted-foreground">
          Invite and reset links only work once and expire after a while. Ask
          Craig to send a fresh invite.
        </p>
        <Link
          href="/login"
          className="text-sm font-bold text-primary underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

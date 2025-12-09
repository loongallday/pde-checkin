# Face Recognition Check-In

Next.js (App Router) experience that lets workplace teams complete a face-match check-in with a clear container → view model (hook) → view pattern, Tailwind v4, and shadcn/ui.

## Getting started

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

## Supabase credentials

Set the following environment variables to switch from the in-memory mock repository to Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The repositories expect:

- `employees` table with columns: `id`, `full_name`, `email`, `role`, `department`, `avatar_url`, `last_check_in`, `embedding_version`, `embedding_vector numeric[]`
- `face_check_events` table with columns: `employee_id`, `captured_at`, `similarity_score`, `is_match`, `snapshot`

## Structure

```
src/
  app/               # Next.js app router entry points + error boundary
  entities/          # Domain entities (Employee, embeddings, match results)
  features/
    face-check/      # Containers, hooks, and views for the feature
  shared/
    components/      # Reusable UI and layout primitives
    lib/             # Face embeddings, math helpers, date formatting
    mocks/           # Mock data used when Supabase is not configured
    repositories/    # Repository interfaces + Supabase + in-memory impls
    services/        # Integration clients (Supabase)
```

The `FaceCheckContainer` wires the repository into `useFaceCheckViewModel`, which exposes declarative state + actions that the view consumes.

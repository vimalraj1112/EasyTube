import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { loginSchema, type LoginValues } from '@/auth/authSchemas';
import { useAuth } from '@/auth/authContext';
import { FormAlert, TextField } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/Spinner';
import { ApiClientError } from '@/lib/apiClient';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    void handleSubmit(async (values) => {
      setFormError(null);
      try {
        await login({ email: values.email, password: values.password });
        const from = (location.state as LocationState | null)?.from;
        void navigate(from && from !== '/login' ? from : '/account', { replace: true });
      } catch (error) {
        setFormError(ApiClientError.from(error).message);
      }
    })(event);
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-ink-400">
        Your session stays in a secure cookie, so a reload keeps you signed in.
      </p>

      <form
        onSubmit={(event) => void onSubmit(event)}
        className="mt-8 flex flex-col gap-5"
        noValidate
      >
        {formError ? <FormAlert tone="danger">{formError}</FormAlert> : null}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email')}
        />

        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? <Spinner label="Signing in" /> : null}
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-400">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-brand-300 hover:text-brand-200">
          Create one
        </Link>
      </p>
    </div>
  );
}

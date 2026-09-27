import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';

import { registerSchema, type RegisterValues } from '@/auth/authSchemas';
import { useAuth } from '@/auth/authContext';
import { FormAlert, TextField } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/Spinner';
import { ApiClientError } from '@/lib/apiClient';

export function RegisterPage() {
  const { register: createAccount } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    void handleSubmit(async (values) => {
      setFormError(null);
      try {
        await createAccount({
          displayName: values.displayName,
          email: values.email,
          password: values.password,
        });
        void navigate('/account', { replace: true });
      } catch (error) {
        setFormError(ApiClientError.from(error).message);
      }
    })(event);
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-ink-400">
        One account for every format and every device you sign in from.
      </p>

      <form
        onSubmit={(event) => void onSubmit(event)}
        className="mt-8 flex flex-col gap-5"
        noValidate
      >
        {formError ? <FormAlert tone="danger">{formError}</FormAlert> : null}

        <TextField
          label="Name"
          autoComplete="name"
          placeholder="Alex Rivera"
          error={errors.displayName?.message}
          {...register('displayName')}
        />

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
          autoComplete="new-password"
          hint="At least 12 characters, with lower case, upper case and a digit."
          error={errors.password?.message}
          {...register('password')}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? <Spinner label="Creating your account" /> : null}
          {isSubmitting ? 'Creating your account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-400">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-brand-300 hover:text-brand-200">
          Sign in
        </Link>
      </p>
    </div>
  );
}


'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Loader2, Eye, EyeOff, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Logo } from '@/components/logo';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getApiUrl } from '@/lib/api-config';


const loginSchema = z.object({
  username: z.string().min(1, { message: 'Username is required' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

type LoginFormValues = z.infer<typeof loginSchema>;


export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);

  // const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    fetch('/api/license/status')
      .then((r) => r.json())
      .then((res) => {
        if (res?.data?.status !== 'active') {
          router.replace('/activate');
        } else {
          setLicenseChecked(true);
        }
      })
      .catch(() => {
        setLicenseChecked(true);
      });
  }, [router]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(getApiUrl('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Login failed');
      }

      // Store user session (matching previous mock structure for compatibility)
      localStorage.setItem('mock-user-session', JSON.stringify({
        email: result.username, // Keeping 'email' key if other parts of app rely on it, but storing username
        username: result.username,
        permissions: result.permissions,
        userType: result.userType,
        roleId: result.roleId,
        uid: result.uid,
        displayName: result.displayName,
        photoURL: result.photoURL
      }));

      // Redirect based on user type (logic adapted from previous mock).
      // `Price Inquiry` is the unattended self-service kiosk account: it owns
      // the price-checker screen and nothing else. The app layout also pins it
      // there, so a typed URL cannot escape — this is just the first hop.
      if (result.userType === 'Price Inquiry') {
         router.push('/price-check');
      } else if (result.userType === 'Cashier' || result.userType === 'Employee') {
         router.push('/pos');
      } else {
         router.push('/');
      }

    } catch (err: any) {
      const errorMessage = err.message || 'Invalid credentials. Please try again.';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };


  if (!licenseChecked) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full lg:grid lg:grid-cols-2">
      <div className="flex items-center justify-center py-12 px-6 bg-background">
        <div className="mx-auto grid w-full max-w-[400px] gap-6 animate-fade-in">
          <div className="flex flex-col items-center mb-6 space-y-2">
             <div className="flex justify-center mb-6">
                <Logo size={120} />
             </div>
             <div className="space-y-1 text-center">
                <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center justify-center gap-2">
                  Welcome back
                  {error && (
                    <Badge variant="destructive" className="ml-2 px-2 py-0.5 animate-in zoom-in-95 duration-300">
                      <XCircle className="w-3 h-3 mr-1" />
                      Invalid
                    </Badge>
                  )}
                </h1>
                 <p className="text-muted-foreground text-sm">Enter your credentials to access your account</p>
             </div>
          </div>
          
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
            {error && (
              <Alert variant="destructive" className="animate-in slide-in-from-top-2">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Login Failed</AlertTitle>
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>
            )}
            
            <div className="grid gap-2 group">
              <Label htmlFor="username">Username</Label>
              <Input 
                id="username" 
                type="text" 
                placeholder="Enter your username" 
                {...form.register('username')} 
                className="h-11 transition-all focus-visible:ring-primary/20"
              />
              {form.formState.errors.username && <p className="text-sm font-medium text-destructive">{form.formState.errors.username.message}</p>}
            </div>
            
            <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input 
                    id="password" 
                    type={showPassword ? 'text' : 'password'} 
                    placeholder="Enter your password" 
                    {...form.register('password')} 
                    className="h-11 pr-10 transition-all focus-visible:ring-primary/20"
                />
                 <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(prev => !prev)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>
                </Button>
              </div>
              {form.formState.errors.password && <p className="text-sm font-medium text-destructive">{form.formState.errors.password.message}</p>}
            </div>
            
            <Button className="w-full h-11 text-base shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <div className="flex justify-center">
              <Badge variant="secondary" className="text-xs font-medium text-muted-foreground">
                v{process.env.NEXT_PUBLIC_APP_VERSION}
              </Badge>
            </div>
          )}

        </div>
      </div>

      {/* Right Side - Abstract/Branded Background */}
      <div className="hidden bg-muted lg:block relative overflow-hidden">
         <div className="absolute inset-0 bg-slate-900 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black z-0" />
         
         <div className="absolute inset-0 z-10 opacity-30 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] brightness-100 contrast-150 mix-blend-overlay" />
         
         <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-center p-12 text-slate-100/90 space-y-8 animate-fade-in delay-150">
             <div className="w-full max-w-lg space-y-4 backdrop-blur-sm bg-white/5 p-8 rounded-2xl border border-white/10 shadow-2xl">
                 <div className="flex justify-center mb-4">
                    <Logo className="size-24 text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
                 </div>
                 <p className="text-slate-300 text-lg leading-relaxed">
                    The modern operating system for your retail business. Powerful inventory management, seamless POS, and intelligent analytics.
                 </p>
             </div>
             
             <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
                    <div className="text-xl font-bold text-indigo-300 mb-1">POS</div>
                    <div className="text-sm text-slate-400">Fast & Intuitive</div>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
                    <div className="text-xl font-bold text-indigo-300 mb-1">Real-time</div>
                    <div className="text-sm text-slate-400">Analytics & Reports</div>
                </div>
             </div>
         </div>
         
         {/* Decorative Gradients */}
         <div className="absolute top-0 right-0 -mr-20 -mt-20 w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-[100px] z-0" />
         <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[100px] z-0" />
      </div>
    </div>
  );
}

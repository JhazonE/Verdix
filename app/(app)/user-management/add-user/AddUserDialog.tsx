'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Loader2 } from 'lucide-react';
import { AddUserTypeDialog } from '../add-user-type/AddUserTypeDialog';
import { UserTypeSelectField } from '../UserTypeSelectField';
import { UserPermissionsGrid } from '../UserPermissionsGrid';
import { useAddUser } from './use-add-user';

export function AddUserDialog({ onUserAdded }: { onUserAdded: () => void }) {
  const {
    isOpen, setIsOpen, form, onSubmit,
    userTypes, fetchUserTypes,
    isUserTypeDialogOpen, setIsUserTypeDialogOpen,
  } = useAddUser({ onUserAdded });

  const { isSubmitting } = form.formState;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusCircle className="mr-2 h-4 w-4" /> Add User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] p-0 overflow-hidden flex flex-col max-h-[95vh] border-none shadow-2xl">
        <DialogHeader className="p-8 pb-4 bg-muted/30">
          <DialogTitle className="text-2xl font-bold">Add New User</DialogTitle>
          <DialogDescription className="text-base">
            Enter the details for the new user and assign specific permissions.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-10">
                {/* Left: User Details */}
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold border-b pb-2">User Details</h3>
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John Doe" {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder="username" {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <UserTypeSelectField form={form} userTypes={userTypes} onCreateNew={() => setIsUserTypeDialogOpen(true)} />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} value={field.value ?? ''} className="h-11" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Right: Permissions */}
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold border-b pb-2">Permissions & Access</h3>
                    <p className="text-sm text-muted-foreground">Select individual access rights for this user.</p>
                  </div>
                  <UserPermissionsGrid form={form} disabledForCashier />
                  <FormField
                    control={form.control}
                    name="permissions"
                    render={() => (
                      <FormItem>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="p-8 pt-4 bg-muted/30 border-t">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      <AddUserTypeDialog
        open={isUserTypeDialogOpen}
        onOpenChange={setIsUserTypeDialogOpen}
        onUserTypeUpdated={fetchUserTypes}
      />
    </Dialog>
  );
}

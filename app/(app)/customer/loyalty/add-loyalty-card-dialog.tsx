'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { CalendarIcon, CreditCard } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { getApiUrl } from '@/lib/api-config';
import type { Customer } from '@/lib/types';

interface CustomerWithLoyalty extends Customer {
  loyaltyPoints: number;
  lastTransaction: string;
  expiryDate: string;
  pointSetting: string;
}

interface LoyaltySetting {
  id: string;
  description: string;
  base: string;
  amount: number;
  equivalent: number;
}

const loyaltyCardSchema = z.object({
  customerId: z.string().optional(),
  rfidCode: z.string().min(1, 'RFID Card Code is required'),
  expiryDate: z.date({
    required_error: 'Expiry date is required',
  }),
  pointSetting: z.string().min(1, 'Point setting is required'),
  initialPoints: z.coerce.number().min(0, 'Initial points must be non-negative'),
});

type LoyaltyCardFormValues = z.infer<typeof loyaltyCardSchema>;

export function AddLoyaltyCardDialog({ 
  customer, 
  showLabel = false, 
  onSuccess,
  children,
  open: controlledOpen,
  onOpenChange: setControlledOpen
}: { 
  customer?: CustomerWithLoyalty, 
  showLabel?: boolean, 
  onSuccess?: () => void,
  children?: React.ReactNode,
  open?: boolean,
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = isControlled ? setControlledOpen || (() => {}) : setInternalOpen;
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySetting[]>([]);
  const { toast } = useToast();

  const isGeneralDialog = !customer;

  const form = useForm<LoyaltyCardFormValues>({
    resolver: zodResolver(loyaltyCardSchema),
    defaultValues: {
      customerId: customer?.id || '',
      rfidCode: '',
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default to 1 year from now
      pointSetting: '',
      initialPoints: 0,
    },
  });

  useEffect(() => {
    if (isOpen) {
      // Fetch loyalty settings
      const fetchSettings = async () => {
        try {
          const response = await fetch(getApiUrl('/loyalty-settings'));
          if (response.ok) {
            const result = await response.json();
            setLoyaltySettings(result.data || []);
            // Optional: set default value if not set
            // if (result.data && result.data.length > 0 && !form.getValues('pointSetting')) {
            //   form.setValue('pointSetting', result.data[0].description);
            // }
          }
        } catch (error) {
          console.error('Failed to fetch loyalty settings:', error);
        }
      };
      fetchSettings();

      if (isGeneralDialog) {
        // Fetch customers when dialog opens and no specific customer is provided
        const fetchCustomers = async () => {
          try {
            const response = await fetch(getApiUrl('/customers'));
            if (response.ok) {
              const result = await response.json();
              setCustomers(result.data || []);
            }
          } catch (error) {
            console.error('Failed to fetch customers:', error);
          }
        };
        fetchCustomers();
      }
    }
  }, [isOpen, isGeneralDialog]);

  async function onSubmit(values: LoyaltyCardFormValues) {
    const targetCustomerId = customer?.id || values.customerId;
    const targetCustomer = customer || customers.find(c => c.id === values.customerId);

    if (!targetCustomer) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please select a customer.',
      });
      return;
    }

    try {
      const response = await fetch(getApiUrl('/customer-loyalty'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: targetCustomerId,
          rfidCode: values.rfidCode,
          expiryDate: values.expiryDate ? format(values.expiryDate, 'yyyy-MM-dd') : null,
          pointSetting: values.pointSetting,
          initialPoints: values.initialPoints,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Loyalty Card Added',
          description: `RFID card ${values.rfidCode} has been assigned to ${targetCustomer.name}.`,
        });
        setIsOpen(false);
        form.reset();
        if (onSuccess) {
          onSuccess();
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.error || 'Failed to add loyalty card.',
        });
      }
    } catch (error) {
      console.error('Error adding loyalty card:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add loyalty card. Please try again.',
      });
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children ? children : (
          <Button variant="outline" size="sm" title="Add Loyalty Card">
            <CreditCard className="h-4 w-4" />
            {showLabel && "Add Loyalty Card"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Loyalty Card</DialogTitle>
          <DialogDescription>
            {customer
              ? `Assign a new RFID loyalty card to ${customer.name}.`
              : 'Select a customer and assign a new RFID loyalty card.'
            }
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onKeyDown={(e) => {
              // An RFID reader is a keyboard: it types the card code and then
              // sends Enter. Inside a <form> that Enter is an implicit submit,
              // so a scan into the RFID Card Code field used to ADD the card
              // instead of just filling the field. Suppress implicit
              // submission from single-line inputs — adding stays on the
              // explicit "Add Loyalty Card" button (type="submit"). Enter in a
              // <textarea> (newline) and on buttons/links (activation) must
              // still work, so they are exempt.
              if (e.key !== 'Enter' || e.shiftKey) return;
              const el = e.target as HTMLElement | null;
              const tag = el?.tagName;
              if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
              if (el?.getAttribute('role') === 'button') return;
              if (el?.isContentEditable) return;
              e.preventDefault();
            }}
            className="space-y-4"
          >
            {isGeneralDialog && (
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Customer</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a customer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers.map((cust) => (
                          <SelectItem key={cust.id} value={cust.id}>
                            {cust.name} ({cust.contactNumber})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="rfidCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RFID Card Code</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., RFID-123456789" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expiryDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Expiry Date</FormLabel>
                  <Popover modal={false}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            'w-full pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value ? (
                            format(field.value, 'PPP')
                          ) : (
                            <span>Pick a date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) =>
                          date < new Date() || date < new Date('1900-01-01')
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pointSetting"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Point Setting</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Point Setting" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {loyaltySettings.length > 0 ? (
                        loyaltySettings.map((setting) => (
                          <SelectItem key={setting.id} value={setting.description}>
                            {setting.description} ({setting.amount} pts / {setting.equivalent})
                          </SelectItem>
                        ))
                      ) : (
                         <SelectItem value="none" disabled>No settings available</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="initialPoints"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Points</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" placeholder="0" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                Add Loyalty Card
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

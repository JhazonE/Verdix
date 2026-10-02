'use client';

import * as React from 'react';
import { format, parse, isValid } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const ISO = 'yyyy-MM-dd';

interface DatePickerProps {
  /** Date as a `yyyy-MM-dd` string, or empty. Matches what `<input type="date">` produced, so form values keep their shape. */
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Show an X that empties the field. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  clearable = false,
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const parsed = value ? parse(value, ISO, new Date()) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              'h-8 w-full justify-start px-3 text-xs font-normal bg-background',
              !selected && 'text-muted-foreground',
              clearable && selected && 'pr-8',
              className,
            )}
          >
            <CalendarIcon className="mr-2 h-3.5 w-3.5 shrink-0 opacity-60" />
            {selected ? format(selected, 'MMM dd, yyyy') : placeholder}
          </Button>
        </PopoverTrigger>
        {clearable && selected && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onChange('')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date(2040, 11)}
          onSelect={(d) => {
            onChange(d ? format(d, ISO) : '');
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

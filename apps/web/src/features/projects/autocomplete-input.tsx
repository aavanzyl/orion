import { useId } from 'react';
import { Input } from '@/components/ui/input';

export interface AutocompleteInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'list'> {
  /** Suggestions offered as the user types; free text is still allowed. */
  options: string[];
}

/**
 * A text input with native autocomplete suggestions (via `<datalist>`). Unlike a
 * select, the user can still type any value — suggestions just speed up common
 * entries like provider keys, model ids and command file paths.
 */
export function AutocompleteInput({ options, ...props }: AutocompleteInputProps) {
  const listId = useId();
  return (
    <>
      <Input list={listId} {...props} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}

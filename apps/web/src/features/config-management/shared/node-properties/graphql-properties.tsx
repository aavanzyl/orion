import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldLabel, type NodeTypeEditorProps } from './fields';
import { HeadersEditor, TokenField } from './http-properties';

/**
 * Property editor for `graphql` nodes: the endpoint URL, the query/mutation
 * document, optional JSON variables, request headers and an encrypted bearer
 * token. The operation is always POSTed as `application/json`.
 */
export function GraphqlProperties({ data, onChange }: NodeTypeEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Endpoint URL</FieldLabel>
        <Input
          value={data.url ?? ''}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://api.example.com/graphql"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Query / mutation</FieldLabel>
        <Textarea
          value={data.query ?? ''}
          onChange={(e) => onChange({ query: e.target.value })}
          placeholder={'query { viewer { login } }'}
          className="min-h-28 font-mono text-xs"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Supports <code>{'{{'} nodes.id.path {'}}'}</code> substitution.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Variables (JSON, optional)</FieldLabel>
        <Textarea
          value={data.variables ?? ''}
          onChange={(e) => onChange({ variables: e.target.value })}
          placeholder={'{"id": "{{ nodes.plan.data.id }}"}'}
          className="min-h-20 font-mono text-xs"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Headers</FieldLabel>
        <HeadersEditor headers={data.headers ?? {}} onChange={(headers) => onChange({ headers })} />
      </div>
      <TokenField token={data.token} onChange={(token) => onChange({ token })} />
    </div>
  );
}

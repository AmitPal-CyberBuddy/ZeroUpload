import { Fragment } from 'react';
import { Icon } from '../ui/Icon';

export type StageState = 'idle' | 'active' | 'done';

/**
 * Reading → Processing → Complete. Replaces the generic spinner: users can see
 * exactly which phase a local operation is in.
 */
export function StageTimeline({
  stages,
  states,
}: {
  stages: string[];
  states: StageState[];
}) {
  return (
    <div className="stages" role="list" aria-label="Processing stages">
      {stages.map((stage, index) => {
        const state = states[index] ?? 'idle';
        return (
          // A Fragment keeps the line a true sibling of the item: a wrapping div
          // (even with display:contents) breaks `list > listitem` semantics.
          <Fragment key={stage}>
            <div className="stage" data-state={state} role="listitem">
              <span className="stage__node" aria-hidden="true">
                {state === 'done' ? (
                  <Icon name="check" size={10} strokeWidth={2.4} />
                ) : state === 'active' ? (
                  <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1 }} />
                ) : (
                  index + 1
                )}
              </span>
              {stage}
            </div>
            {index < stages.length - 1 ? (
              <span className="stage__line" data-done={state === 'done' || undefined} aria-hidden="true" />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

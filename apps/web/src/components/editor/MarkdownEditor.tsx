'use client';

import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { basicSetup } from 'codemirror';
import {
  Decoration,
  EditorView,
  type DecorationSet,
  placeholder,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';

export interface TextSelection {
  from: number;
  to: number;
  text: string;
}

interface MarkdownEditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  canEdit: boolean;
  highlightRanges: Array<{ from: number; to: number }>;
  onSelectionChange: (selection: TextSelection) => void;
  onViewReady: (view: EditorView) => void;
}

const setCommentHighlights = StateEffect.define<Array<{ from: number; to: number }>>();

const commentHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setCommentHighlights)) {
        const marks = effect.value
          .filter((range) => range.from < range.to)
          .sort((a, b) => a.from - b.from)
          .map((range) =>
            Decoration.mark({ class: 'cm-comment-anchor' }).range(range.from, range.to),
          );
        next = Decoration.set(marks, true);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#171610',
      color: '#efe9da',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.8',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: '26px 0 80px',
      caretColor: '#f2a65a',
    },
    '.cm-line': {
      padding: '0 26px',
    },
    '.cm-gutters': {
      backgroundColor: '#171610',
      color: '#5f5949',
      border: 'none',
      paddingLeft: '12px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 250, 235, 0.035)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: '#a39b87',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(232, 85, 47, 0.24) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(232, 85, 47, 0.32) !important',
    },
    '.cm-cursor': {
      borderLeftColor: '#f2a65a',
      borderLeftWidth: '2px',
    },
    '.cm-comment-anchor': {
      backgroundColor: 'rgba(242, 166, 90, 0.14)',
      borderBottom: '1px solid rgba(242, 166, 90, 0.55)',
    },
  },
  { dark: true },
);

export function MarkdownEditor({
  ytext,
  awareness,
  canEdit,
  highlightRanges,
  onSelectionChange,
  onViewReady,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onSelectionChange, onViewReady });
  callbacks.current = { onSelectionChange, onViewReady };

  useEffect(() => {
    if (!hostRef.current) return;
    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          markdown(),
          syntaxHighlighting(oneDarkHighlightStyle),
          editorTheme,
          commentHighlightField,
          EditorView.lineWrapping,
          EditorView.editable.of(canEdit),
          EditorState.readOnly.of(!canEdit),
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet) return;
            const range = update.state.selection.main;
            callbacks.current.onSelectionChange({
              from: range.from,
              to: range.to,
              text: update.state.sliceDoc(range.from, range.to),
            });
          }),
          placeholder(
            canEdit
              ? 'Start writing. Anyone with the link sees it as you type.'
              : 'Read-only view. Select text to leave a comment.',
          ),
          yCollab(ytext, awareness, { undoManager }),
        ],
      }),
    });

    viewRef.current = view;
    callbacks.current.onViewReady(view);

    return () => {
      viewRef.current = null;
      view.destroy();
      undoManager.destroy();
    };
  }, [ytext, awareness, canEdit]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setCommentHighlights.of(highlightRanges) });
  }, [highlightRanges]);

  return <div className="editor-host" ref={hostRef} />;
}

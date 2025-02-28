import { VueGeneratedCode, forEachEmbeddedCode, isFoldingRangesEnabled } from '@vue/language-core';
import { camelize, capitalize, hyphenate } from '@vue/shared';
import * as path from 'path-browserify';
import type * as vscode from 'vscode-languageserver-protocol';
import { createAddComponentToOptionEdit, getLastImportNode } from '../plugins/vue-extract-file';
import { ServicePlugin, ServicePluginInstance, TagNameCasing } from '../types';

export function create(ts: typeof import('typescript/lib/tsserverlibrary')): ServicePlugin {
	return {
		name: 'vue-document-drop',
		create(context): ServicePluginInstance {

			let casing: TagNameCasing = TagNameCasing.Pascal; // TODO

			return {
				async provideDocumentDropEdits(document, _position, dataTransfer) {

					if (document.languageId !== 'html')
						return;

					const [virtualCode, sourceFile] = context.documents.getVirtualCodeByUri(document.uri);
					const vueFile = sourceFile?.generated?.code;
					if (!virtualCode || !(vueFile instanceof VueGeneratedCode))
						return;

					let importUri: string | undefined;
					for (const [mimeType, item] of dataTransfer) {
						if (mimeType === 'text/uri-list') {
							importUri = item.value as string;
						}
					}
					if (!importUri?.endsWith('.vue'))
						return;

					let baseName = importUri.substring(importUri.lastIndexOf('/') + 1);
					baseName = baseName.substring(0, baseName.lastIndexOf('.'));
					const newName = capitalize(camelize(baseName));

					let additionalEdit: vscode.WorkspaceEdit | undefined;

					for (const file of forEachEmbeddedCode(vueFile)) {
						if (
							(
								file.languageId === 'typescript'
								|| file.languageId === 'javascript'
								|| file.languageId === 'typescriptreact'
								|| file.languageId === 'javascriptreact'
							)
							&& file.mappings.some(mapping => isFoldingRangesEnabled(mapping.data))
						) {

							additionalEdit ??= {};
							additionalEdit.changes ??= {};
							additionalEdit.changes[context.documents.getVirtualCodeUri(vueFile.id, file.id)] = [];

							const { sfc } = vueFile;
							const script = sfc.scriptSetup ?? sfc.script;
							if (!sfc.template || !script)
								return;

							const lastImportNode = getLastImportNode(ts, script.ast);
							additionalEdit.changes[context.documents.getVirtualCodeUri(vueFile.id, file.id)].push({
								range: lastImportNode ? {
									start: document.positionAt(lastImportNode.end),
									end: document.positionAt(lastImportNode.end),
								} : {
									start: document.positionAt(0),
									end: document.positionAt(0),
								},
								newText: `\nimport ${newName} from './${path.relative(path.dirname(document.uri), importUri) || importUri.substring(importUri.lastIndexOf('/') + 1)}'`
									+ (lastImportNode ? '' : '\n'),
							});
							if (sfc.script) {
								const edit = createAddComponentToOptionEdit(ts, sfc.script.ast, newName);
								if (edit) {
									additionalEdit.changes[context.documents.getVirtualCodeUri(vueFile.id, file.id)].push({
										range: {
											start: document.positionAt(edit.range.start),
											end: document.positionAt(edit.range.end),
										},
										newText: edit.newText,
									});
								}
							}
						}
					}

					return {
						insertText: `<${casing === TagNameCasing.Kebab ? hyphenate(newName) : newName}$0 />`,
						insertTextFormat: 2 satisfies typeof vscode.InsertTextFormat.Snippet,
						additionalEdit,
					};
				},
			};
		},
	};
}

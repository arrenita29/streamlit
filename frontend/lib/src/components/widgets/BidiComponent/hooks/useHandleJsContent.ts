/**
 * Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2025)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useContext, useEffect, useId, useMemo } from "react"

import {
  ComponentArgs,
  ComponentState,
  OptionalComponentCleanupFunction,
} from "@streamlit/component-v2-lib"

import { LibContext } from "~lib/components/core/LibContext"
import { BidiComponentContext } from "~lib/components/widgets/BidiComponent/BidiComponentContext"
import {
  handleError,
  normalizeError,
} from "~lib/components/widgets/BidiComponent/utils/error"
import { makeTriggerAggregatorId } from "~lib/components/widgets/BidiComponent/utils/idBuilder"
import { LOG } from "~lib/components/widgets/BidiComponent/utils/logger"
import { useRequiredContext } from "~lib/hooks/useRequiredContext"
import type { WidgetStateManager } from "~lib/WidgetStateManager"

const loadAndRunModule = async <T extends ComponentState>({
  componentId,
  componentIdForWidgetMgr,
  componentName,
  data,
  formId,
  fragmentId,
  getWidgetValue,
  moduleUrl,
  parentElement,
  widgetMgr,
}: {
  componentId: string
  componentIdForWidgetMgr: string
  componentName: string
  data: unknown
  getWidgetValue: () => T
  formId: string | undefined
  fragmentId: string | undefined
  moduleUrl: string
  parentElement: HTMLElement | ShadowRoot
  widgetMgr: WidgetStateManager
}): Promise<OptionalComponentCleanupFunction> => {
  const module = await import(/* @vite-ignore */ moduleUrl)

  if (!module) {
    throw new Error("JS module does not exist.")
  }

  if (!module.default || typeof module.default !== "function") {
    throw new Error("JS module does not have a default export function.")
  }

  const setStateValue = <T extends ComponentState>(
    name: string,
    value: T[keyof T]
  ): void => {
    let newValue: T = {} as T

    try {
      const existingValue = getWidgetValue()

      newValue = { ...existingValue, [name]: value } as T
    } catch (error) {
      LOG.error(`Failed to get existing value for ${name}`, error)
      newValue = { [name]: value } as T
    }

    void widgetMgr.setJsonValue(
      { id: componentIdForWidgetMgr, formId },
      newValue,
      { fromUi: true },
      fragmentId
    )
  }

  const setTriggerValue = <T extends ComponentState>(
    name: string,
    value: T[keyof T]
  ): void => {
    // IMPORTANT: Triggers are not allowed inside forms in Streamlit's execution
    // model. Native buttons cannot be placed in forms, and form semantics defer
    // updates until submit. To align CCv2 with existing behavior without
    // changing global runtime semantics, we no-op trigger calls when the
    // component is rendered inside a form. Developers should use setStateValue
    // and the form submit button to commit changes.
    if (formId) {
      LOG.warn(
        "BidiComponent: setTriggerValue ignored inside st.form. Triggers are not allowed in forms; use setStateValue and form submit instead."
      )
      return
    }
    const triggerId = makeTriggerAggregatorId(componentIdForWidgetMgr)
    void widgetMgr.setTriggerValue(
      { id: triggerId, formId },
      { fromUi: true },
      fragmentId,
      { event: name, value }
    )
  }

  return module.default({
    name: componentName,
    data,
    key: componentId,
    parentElement,
    setStateValue,
    setTriggerValue,
  } satisfies ComponentArgs)
}

export const useHandleJsContent = ({
  containerRef,
  setError,
  skip = false,
}: {
  containerRef: React.RefObject<HTMLElement | ShadowRoot>
  setError: (error: Error) => void
  skip?: boolean
}): void => {
  const componentId = `st-bidi-component-${useId()}`

  const {
    componentName,
    data,
    formId,
    fragmentId,
    getWidgetValue,
    id,
    jsContent,
    jsSourcePath,
    theme,
    widgetMgr,
  } = useRequiredContext(BidiComponentContext)

  const {
    componentRegistry: { getBidiComponentURL },
  } = useContext(LibContext)

  const jsSourcePathUrl = useMemo(() => {
    if (!jsSourcePath) {
      return undefined
    }
    return getBidiComponentURL(componentName, jsSourcePath)
  }, [componentName, jsSourcePath, getBidiComponentURL])

  useEffect(() => {
    const { current: containerRefCurrent } = containerRef

    if (
      // Skip if the hook is explicitly skipped
      skip ||
      // Skip if there is no JS content or source path
      (!jsContent && !jsSourcePathUrl) ||
      // Skip if the container ref is not available
      !containerRefCurrent
    ) {
      return
    }

    let isMounted = true
    let cleanup: OptionalComponentCleanupFunction
    let scriptElement: HTMLScriptElement | undefined

    const run = async (): Promise<void> => {
      try {
        // Handle inline JS content
        if (jsContent) {
          const dataUri = `data:text/javascript;charset=utf-8,${encodeURIComponent(
            jsContent
          )}`

          cleanup = await loadAndRunModule({
            componentId,
            componentIdForWidgetMgr: id,
            componentName,
            data,
            formId,
            fragmentId,
            getWidgetValue,
            moduleUrl: dataUri,
            parentElement: containerRefCurrent,
            widgetMgr,
          })
        }
        // Handle external JS file
        else if (jsSourcePathUrl) {
          const scriptUrl = jsSourcePathUrl

          try {
            // Load the script
            await new Promise<void>((resolve, reject) => {
              scriptElement = document.createElement("script")
              scriptElement.type = "module"
              scriptElement.src = scriptUrl
              scriptElement.async = true
              scriptElement.onload = () => resolve()
              scriptElement.onerror = () =>
                reject(
                  new Error(`Failed to load script from ${jsSourcePathUrl}`)
                )
              document.head.appendChild(scriptElement)
            })

            // Run the module
            cleanup = await loadAndRunModule({
              componentId,
              componentIdForWidgetMgr: id,
              componentName,
              data,
              formId,
              fragmentId,
              getWidgetValue,
              moduleUrl: scriptUrl,
              parentElement: containerRefCurrent,
              widgetMgr,
            })
          } catch (error) {
            throw normalizeError(
              error,
              `Failed to load or execute script from ${jsSourcePathUrl}`
            )
          }
        }
      } catch (error) {
        if (isMounted) {
          handleError(error, setError)
        }
      }
    }

    void run()

    // Cleanup function
    return () => {
      isMounted = false

      if (cleanup) {
        void Promise.resolve(cleanup)
          .then(result => {
            result?.()
          })
          .catch(error => {
            LOG.error(`Failed to run cleanup for element ${id}`, error)
          })
      }

      if (scriptElement?.parentNode) {
        scriptElement.parentNode.removeChild(scriptElement)
      }
    }
  }, [
    componentId,
    componentName,
    containerRef,
    data,
    formId,
    fragmentId,
    getWidgetValue,
    id,
    jsContent,
    jsSourcePathUrl,
    setError,
    skip,
    widgetMgr,
    // We want to re-run the JS content if the theme changes
    theme,
  ])
}

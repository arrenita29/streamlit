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

import { FC, memo, PropsWithChildren, useCallback, useMemo } from "react"

import type { BidiComponent as BidiComponentProto } from "@streamlit/protobuf"

import {
  BidiComponentContext,
  BidiComponentContextShape,
} from "~lib/components/widgets/BidiComponent/BidiComponentContext"
import { parseBidiComponentData } from "~lib/components/widgets/BidiComponent/utils/parseBidiComponentData"
import { extractComponentsV2Theme } from "~lib/components/widgets/BidiComponent/utils/theme"
import { useEmotionTheme } from "~lib/hooks/useEmotionTheme"
import { WidgetInfo, WidgetStateManager } from "~lib/WidgetStateManager"

export type BidiComponentContextProviderProps = {
  element: BidiComponentProto
  widgetMgr: WidgetStateManager
  fragmentId: string | undefined
}

export const BidiComponentContextProvider: FC<
  PropsWithChildren<BidiComponentContextProviderProps>
> = memo(({ element, children, widgetMgr, fragmentId }) => {
  const {
    arrowData,
    bytes,
    componentName,
    cssContent,
    cssSourcePath,
    data,
    htmlContent,
    id,
    jsContent,
    json,
    jsSourcePath,
    mixed,
  } = element

  const widgetInfo = useMemo<WidgetInfo>(() => {
    return {
      id: element.id,
      formId: element.formId,
    }
  }, [element.id, element.formId])

  const getWidgetValue = useCallback(() => {
    const value = widgetMgr.getJsonValue(widgetInfo)
    return value ? JSON.parse(value) : {}
  }, [widgetInfo, widgetMgr])

  const parsedData = useMemo(() => {
    return parseBidiComponentData({ data, json, arrowData, bytes, mixed })
  }, [data, json, arrowData, bytes, mixed])

  const emotionTheme = useEmotionTheme()
  const theme = useMemo(() => {
    return extractComponentsV2Theme(emotionTheme)
  }, [emotionTheme])

  const contextValue = useMemo<BidiComponentContextShape>(() => {
    return {
      componentName,
      cssContent: cssContent?.trim(),
      cssSourcePath: cssSourcePath || undefined,
      data: parsedData,
      fragmentId,
      getWidgetValue,
      htmlContent: htmlContent?.trim(),
      id,
      formId: element.formId ?? undefined,
      jsContent: jsContent || undefined,
      jsSourcePath: jsSourcePath || undefined,
      theme,
      widgetMgr,
    }
  }, [
    componentName,
    cssContent,
    cssSourcePath,
    fragmentId,
    getWidgetValue,
    htmlContent,
    id,
    element.formId,
    jsContent,
    jsSourcePath,
    parsedData,
    theme,
    widgetMgr,
  ])

  return (
    <BidiComponentContext.Provider value={contextValue}>
      {children}
    </BidiComponentContext.Provider>
  )
})

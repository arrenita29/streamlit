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

import React, {
  ChangeEvent,
  KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { Check, Close, Mic, Send } from "@emotion-icons/material-rounded"
import { Textarea as UITextArea } from "baseui/textarea"
import { useDropzone } from "react-dropzone"

import { useWindowDimensionsContext } from "@streamlit/lib"
import {
  ChatInput as ChatInputProto,
  FileUploaderState as FileUploaderStateProto,
  IChatInputValue,
  IFileURLs,
  UploadedFileInfo as UploadedFileInfoProto,
} from "@streamlit/protobuf"

import { useWaveformController } from "~lib/components/audio"
import { StyledChatAudioWave } from "~lib/components/ChatInput/styled-components"
import Icon from "~lib/components/shared/Icon"
import InputInstructions from "~lib/components/shared/InputInstructions/InputInstructions"
import {
  UploadedStatus,
  UploadFileInfo,
} from "~lib/components/widgets/FileUploader/UploadFileInfo"
import { getAccept } from "~lib/components/widgets/FileUploader/utils"
import { FileUploadClient } from "~lib/FileUploadClient"
import { useCalculatedDimensions } from "~lib/hooks/useCalculatedDimensions"
import { useEmotionTheme } from "~lib/hooks/useEmotionTheme"
import { useTextInputAutoExpand } from "~lib/hooks/useTextInputAutoExpand"
import { FileSize, sizeConverter } from "~lib/util/FileHelper"
import { isEnterKeyPressed } from "~lib/util/inputUtils"
import {
  AcceptFileValue,
  chatInputAcceptFileProtoValueToEnum,
  isNullOrUndefined,
} from "~lib/util/utils"
import { WidgetStateManager } from "~lib/WidgetStateManager"

import ChatFileUploadButton from "./fileUpload/ChatFileUploadButton"
import ChatFileUploadDropzone from "./fileUpload/ChatFileUploadDropzone"
import ChatUploadedFiles from "./fileUpload/ChatUploadedFiles"
import { createDropHandler } from "./fileUpload/createDropHandler"
import { createUploadFileHandler } from "./fileUpload/createFileUploadHandler"
import {
  StyledChatInput,
  StyledChatInputContainer,
  StyledInputInstructionsContainer,
  StyledSendIconButton,
  StyledSendIconButtonContainer,
} from "./styled-components"

export interface Props {
  disabled: boolean
  element: ChatInputProto
  widgetMgr: WidgetStateManager
  uploadClient: FileUploadClient
  fragmentId?: string
}

const updateFile = (
  id: number,
  fileInfo: UploadFileInfo,
  currentFiles: UploadFileInfo[]
): UploadFileInfo[] => currentFiles.map(f => (f.id === id ? fileInfo : f))

const getFile = (
  localFileId: number,
  currentFiles: UploadFileInfo[]
): UploadFileInfo | undefined => currentFiles.find(f => f.id === localFileId)

function ChatInput({
  disabled,
  element,
  widgetMgr,
  fragmentId,
  uploadClient,
}: Props): React.ReactElement {
  const theme = useEmotionTheme()

  const { placeholder, maxChars } = element

  const counterRef = useRef(0)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const processedSetValueRef = useRef(false)

  const { width, elementRef } = useCalculatedDimensions()
  const { innerWidth, innerHeight } = useWindowDimensionsContext()

  // The value specified by the user via the UI. If the user didn't touch this widget's UI, the default value is used.
  const [value, setValue] = useState(element.default)
  const [files, setFiles] = useState<UploadFileInfo[]>([])
  const [audioFile, setAudioFile] = useState<UploadFileInfo | null>(null)
  const [fileDragged, setFileDragged] = useState(false)

  // Read acceptAudio from the element configuration
  const acceptAudio = element.acceptAudio ?? false

  // Create waveform controller for audio recording
  const controller = useWaveformController({
    events: {
      onApprove: (wav: Blob) => {
        // Convert blob to File
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
        const audioFile = new File([wav], `audio-${timestamp}.wav`, {
          type: "audio/wav",
        })

        // Handle async upload logic
        /* eslint-disable @typescript-eslint/no-use-before-define */
        ;(async () => {
          try {
            // 1. Fetch upload URL
            const fileURLsArray = await uploadClient.fetchFileURLs([audioFile])

            if (fileURLsArray.length === 0) {
              throw new Error("Failed to get upload URL for audio file")
            }

            // 2. Upload audio and wait for completion
            const uploadedInfo = await uploadAudioFile(
              fileURLsArray[0],
              audioFile
            )

            // 3. Set audio state with uploaded info
            setAudioFile(uploadedInfo)

            // 4. Submit immediately - React 18's automatic batching ensures state is updated
            handleSubmit()
          } catch (error) {
            // Handle upload error - set error state for audio
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            setAudioFile(
              new UploadFileInfo(
                audioFile.name,
                audioFile.size,
                getNextLocalFileId(),
                {
                  type: "error",
                  errorMessage,
                }
              )
            )

            // Focus back on input even on error
            if (chatInputRef.current) {
              chatInputRef.current.focus()
            }
          }
        })().catch(_error => {
          // Error already handled in the try-catch above
        })
        /* eslint-enable @typescript-eslint/no-use-before-define */
      },
    },
  })

  const autoExpand = useTextInputAutoExpand({
    textareaRef: chatInputRef,
    dependencies: [placeholder],
  })

  /**
   * @returns True if the user-specified state.value has not yet been synced to
   * the WidgetStateManager.
   */
  const dirty = useMemo(() => {
    if (files.some(f => f.status.type === "uploading")) {
      return false
    }

    if (audioFile && audioFile.status.type === "uploading") {
      return false
    }

    return (
      value !== "" ||
      files.length > 0 ||
      (audioFile !== null && audioFile.status.type === "uploaded")
    )
  }, [files, value, audioFile])

  const acceptFile = chatInputAcceptFileProtoValueToEnum(element.acceptFile)
  const maxFileSize = sizeConverter(
    element.maxUploadSizeMb,
    FileSize.Megabyte,
    FileSize.Byte
  )

  const addFiles = useCallback(
    (filesToAdd: UploadFileInfo[]): void =>
      setFiles(currentFiles => [...currentFiles, ...filesToAdd]),
    []
  )

  const deleteUploadedFile = useCallback(
    (file: UploadFileInfo): void => {
      // Abort ongoing upload if file is still uploading
      if (file.status.type === "uploading") {
        file.status.abortController.abort()
      }

      // Delete file from server if it was successfully uploaded
      if (file.status.type === "uploaded" && file.status.fileUrls.deleteUrl) {
        // Fire-and-forget deletion - errors are not critical to user flow
        uploadClient.deleteFile(file.status.fileUrls.deleteUrl).catch(() => {
          // Silently ignore deletion errors - file may already be deleted or server unavailable
          // This is a cleanup operation that shouldn't block the user
        })
      }
    },
    [uploadClient]
  )

  const deleteFile = useCallback(
    (fileId: number): void => {
      setFiles(prevFiles => {
        const file = getFile(fileId, prevFiles)
        if (isNullOrUndefined(file)) {
          return prevFiles
        }

        // Handle abort/deletion using shared helper
        deleteUploadedFile(file)

        return prevFiles.filter(fileArg => fileArg.id !== fileId)
      })
    },
    [deleteUploadedFile]
  )

  const handleDeleteFileOrAudio = useCallback(
    (fileId: number): void => {
      // Check if it's the audio file
      if (audioFile && audioFile.id === fileId) {
        // Handle abort/deletion using shared helper
        deleteUploadedFile(audioFile)
        setAudioFile(null)
      } else {
        // It's a regular file
        deleteFile(fileId)
      }
    },
    [audioFile, deleteUploadedFile, deleteFile]
  )

  const createChatInputWidgetFilesValue =
    useCallback((): FileUploaderStateProto => {
      const uploadedFileInfo: UploadedFileInfoProto[] = files
        .filter(f => f.status.type === "uploaded")
        .map(f => {
          const { name, size, status } = f
          const { fileId, fileUrls } = status as UploadedStatus
          return new UploadedFileInfoProto({
            fileId,
            fileUrls,
            name,
            size,
          })
        })

      return new FileUploaderStateProto({ uploadedFileInfo })
    }, [files])

  const createChatInputAudioFileInfo = useCallback(():
    | UploadedFileInfoProto
    | undefined => {
    if (!audioFile || audioFile.status.type !== "uploaded") {
      return undefined
    }

    const { name, size, status } = audioFile
    const { fileId, fileUrls } = status

    return new UploadedFileInfoProto({
      fileId,
      fileUrls,
      name,
      size,
    })
  }, [audioFile])

  const getNextLocalFileId = useCallback((): number => {
    return counterRef.current++
  }, [])

  const uploadAudioFile = useCallback(
    async (fileUrls: IFileURLs, file: File): Promise<UploadFileInfo> => {
      return new Promise((resolve, reject) => {
        const localFileId = getNextLocalFileId()
        const abortController = new AbortController()

        const uploadFileInfo = new UploadFileInfo(
          file.name,
          file.size,
          localFileId,
          {
            type: "uploading",
            abortController,
            progress: 0,
          }
        )

        uploadClient
          .uploadFile(
            {
              formId: "",
              ...element,
            },
            fileUrls.uploadUrl as string,
            file,
            (e: ProgressEvent) => {
              const newProgress = Math.round((e.loaded * 100) / e.total)
              uploadFileInfo.setStatus({
                type: "uploading",
                abortController,
                progress: newProgress,
              })
            },
            abortController.signal
          )
          .then(() => {
            const uploadedInfo = uploadFileInfo.setStatus({
              type: "uploaded",
              fileId: fileUrls.fileId as string,
              fileUrls,
            })
            resolve(uploadedInfo)
          })
          .catch((error: Error) => {
            reject(error)
          })
      })
    },
    [uploadClient, element, getNextLocalFileId]
  )

  const dropHandler = createDropHandler({
    acceptMultipleFiles:
      acceptFile === AcceptFileValue.Multiple ||
      acceptFile === AcceptFileValue.Directory,
    acceptDirectoryFiles: acceptFile === AcceptFileValue.Directory,
    maxFileSize: maxFileSize,
    uploadClient: uploadClient,
    uploadFile: createUploadFileHandler({
      getNextLocalFileId,
      addFiles,
      updateFile: (id: number, fileInfo: UploadFileInfo) => {
        setFiles(prevFiles => updateFile(id, fileInfo, prevFiles))
      },
      uploadClient,
      element,
      onUploadProgress: (e: ProgressEvent, fileId: number) => {
        setFiles(prevFiles => {
          const file = getFile(fileId, prevFiles)
          if (isNullOrUndefined(file) || file.status.type !== "uploading") {
            return prevFiles
          }

          const newProgress = Math.round((e.loaded * 100) / e.total)
          if (file.status.progress === newProgress) {
            return prevFiles
          }

          return updateFile(
            fileId,
            file.setStatus({
              type: "uploading",
              abortController: file.status.abortController,
              progress: newProgress,
            }),
            prevFiles
          )
        })
      },
      onUploadComplete: (id: number, fileUrls: IFileURLs) => {
        setFiles(prevFiles => {
          const curFile = getFile(id, prevFiles)
          if (
            isNullOrUndefined(curFile) ||
            curFile.status.type !== "uploading"
          ) {
            // The file may have been canceled right before the upload
            // completed. In this case, we just bail.
            return prevFiles
          }

          return updateFile(
            curFile.id,
            curFile.setStatus({
              type: "uploaded",
              fileId: fileUrls.fileId as string,
              fileUrls,
            }),
            prevFiles
          )
        })
      },
    }),
    addFiles,
    getNextLocalFileId,
    deleteExistingFiles: () => files.forEach(f => deleteFile(f.id)),
    onUploadComplete: () => {
      if (chatInputRef.current) {
        chatInputRef.current.focus()
      }
    },
    element,
  })

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: dropHandler,
    multiple:
      acceptFile === AcceptFileValue.Multiple ||
      acceptFile === AcceptFileValue.Directory,
    accept: getAccept(element.fileType),
    maxSize: maxFileSize,
  })

  const handleSubmit = useCallback((): void => {
    // We want the chat input to always be in focus
    // even if the user clicks the submit button
    if (chatInputRef.current) {
      chatInputRef.current.focus()
    }

    if (!dirty || disabled) {
      return
    }

    const audioInfo = createChatInputAudioFileInfo()
    const filesValue = createChatInputWidgetFilesValue()

    const composedValue: IChatInputValue = {
      data: value,
      fileUploaderState: filesValue,
      audioFileInfo: audioInfo,
    }

    widgetMgr.setChatInputValue(
      element,
      composedValue,
      { fromUi: true },
      fragmentId
    )
    setFiles([])
    setAudioFile(null)
    setValue("")
    autoExpand.clearScrollHeight()
  }, [
    dirty,
    disabled,
    value,
    createChatInputWidgetFilesValue,
    createChatInputAudioFileInfo,
    widgetMgr,
    element,
    fragmentId,
    autoExpand,
  ])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const { metaKey, ctrlKey, shiftKey } = e
    const shouldSubmit =
      isEnterKeyPressed(e) && !shiftKey && !ctrlKey && !metaKey

    if (shouldSubmit) {
      e.preventDefault()

      handleSubmit()
    }
  }

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const { value: targetValue } = e.target

    if (maxChars !== 0 && targetValue.length > maxChars) {
      return
    }

    setValue(targetValue)
    autoExpand.updateScrollHeight()
  }

  const handleMicClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (!acceptAudio || disabled || controller.state === "recording") {
        return
      }

      try {
        await controller.start()
      } catch {
        // Error handling is done via controller events
      }
    },
    [acceptAudio, disabled, controller]
  )

  const handleRecordingCancel = useCallback(() => {
    controller.cancel()
    if (chatInputRef.current) {
      chatInputRef.current.focus()
    }
  }, [controller])

  const handleRecordingApprove = useCallback(async () => {
    try {
      // Stop recording and get the blob
      const { blob } = await controller.stop()
      // Approve the recording (encodes to WAV and triggers onApprove event which handles upload)
      await controller.approve(blob)
    } catch {
      // Error handling is done via controller events
    }
  }, [controller])

  // Handle setValue command from backend
  // This runs when element.setValue is true, indicating the backend wants to set a new value
  useEffect(() => {
    if (element.setValue && !processedSetValueRef.current) {
      // Mark this setValue as processed to avoid re-processing
      processedSetValueRef.current = true
      const val = element.value || ""
      setValue(val)
    }
  }, [element.setValue, element.value])

  // Reset the processed flag when element reference changes (new widget instance)
  useEffect(() => {
    processedSetValueRef.current = false
  }, [element])

  useEffect(() => {
    const handleDragEnter = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (!fileDragged && event.dataTransfer?.types.includes("Files")) {
        setFileDragged(true)
      }
    }

    const handleDragLeave = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (fileDragged) {
        // This check prevents the dropzone from flickering since the dragleave
        // event could fire when user is dragging within the window
        if (
          (event.clientX <= 0 && event.clientY <= 0) ||
          (event.clientX >= innerWidth && event.clientY >= innerHeight)
        ) {
          setFileDragged(false)
        }
      }
    }

    const handleDrop = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (fileDragged) {
        setFileDragged(false)
      }
    }

    window.addEventListener("dragover", handleDragEnter)
    window.addEventListener("drop", handleDrop)
    window.addEventListener("dragleave", handleDragLeave)

    return () => {
      window.removeEventListener("dragover", handleDragEnter)
      window.removeEventListener("drop", handleDrop)
      window.removeEventListener("dragleave", handleDragLeave)
    }
  }, [fileDragged, innerWidth, innerHeight])

  const showDropzone = acceptFile !== AcceptFileValue.None && fileDragged

  // Combine files and audioFile for display
  const allUploadedItems = useMemo(() => {
    const items = [...files]
    if (audioFile) {
      items.push(audioFile)
    }
    return items
  }, [files, audioFile])

  return (
    <>
      {acceptFile === AcceptFileValue.None ? null : (
        <ChatUploadedFiles
          items={allUploadedItems}
          onDelete={handleDeleteFileOrAudio}
        />
      )}
      <StyledChatInputContainer
        className="stChatInput"
        data-testid="stChatInput"
        ref={elementRef}
      >
        {showDropzone ? (
          <ChatFileUploadDropzone
            getRootProps={getRootProps}
            getInputProps={getInputProps}
            acceptFile={acceptFile}
            inputHeight={autoExpand.height}
          />
        ) : (
          <StyledChatInput
            extended={
              autoExpand.isExtended || controller.state === "recording"
            }
          >
            {/* Waveform - always mounted to ensure ref is available for initialization */}
            <div
              style={{
                display: controller.state === "recording" ? "flex" : "none",
                flex: controller.state === "recording" ? 1 : undefined,
                alignItems: "center",
                // Add right padding to account for the two buttons (cancel + approve)
                // Each button is: iconSizes.xl + 2 * spacing.sm
                // Total for 2 buttons: 2 * (iconSizes.xl + 2 * spacing.sm) + spacing.sm (gap)
                paddingRight:
                  controller.state === "recording"
                    ? `calc(2 * (${theme.iconSizes.xl} + 2 * ${theme.spacing.sm}) + ${theme.spacing.sm})`
                    : undefined,
              }}
            >
              <StyledChatAudioWave
                ref={controller.mountRef}
                style={{ width: "100%" }}
              />
            </div>

            {acceptFile === AcceptFileValue.None ||
            controller.state === "recording" ? null : (
              <ChatFileUploadButton
                getRootProps={getRootProps}
                getInputProps={getInputProps}
                acceptFile={acceptFile}
                disabled={disabled}
                theme={theme}
              />
            )}

            {/* Textarea - only shown when not recording */}
            {controller.state !== "recording" && (
              <UITextArea
                inputRef={chatInputRef}
                value={value}
                placeholder={placeholder}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                aria-label={placeholder}
                disabled={disabled}
                rows={1}
                overrides={{
                  Root: {
                    style: {
                      minHeight: theme.sizes.minElementHeight,
                      outline: "none",
                      borderLeftWidth: "0",
                      borderRightWidth: "0",
                      borderTopWidth: "0",
                      borderBottomWidth: "0",
                      borderTopLeftRadius: "0",
                      borderTopRightRadius: "0",
                      borderBottomRightRadius: "0",
                      borderBottomLeftRadius: "0",
                    },
                  },
                  Input: {
                    props: {
                      "data-testid": "stChatInputTextArea",
                    },
                    style: {
                      fontWeight: theme.fontWeights.normal,
                      lineHeight: theme.lineHeights.inputWidget,
                      "::placeholder": {
                        color: theme.colors.fadedText60,
                      },
                      height: autoExpand.height,
                      maxHeight: autoExpand.maxHeight,
                      // Baseweb requires long-hand props, short-hand leads to weird bugs & warnings.
                      paddingLeft: theme.spacing.none,
                      paddingBottom: theme.spacing.sm,
                      paddingTop: theme.spacing.sm,
                      // Calculate the right padding to account for the send icon (iconSizes.xl + 2 * spacing.sm)
                      // and some additional margin between the icon and the text (spacing.sm).
                      paddingRight: `calc(${theme.iconSizes.xl} + 2 * ${theme.spacing.sm} + ${theme.spacing.sm})`,
                    },
                  },
                }}
              />
            )}

            {/* Input instructions - hidden during recording */}
            {controller.state !== "recording" &&
              width > theme.breakpoints.hideWidgetDetails && (
                <StyledInputInstructionsContainer>
                  <InputInstructions
                    dirty={dirty}
                    value={value}
                    maxLength={maxChars}
                    type="chat"
                    // Chat Input are not able to be used in forms
                    inForm={false}
                  />
                </StyledInputInstructionsContainer>
              )}

            {/* Right-side buttons */}
            <StyledSendIconButtonContainer
              isRecording={controller.state === "recording"}
            >
              {controller.state === "recording" ? (
                <>
                  {/* Cancel button (X icon) */}
                  <StyledSendIconButton
                    onClick={handleRecordingCancel}
                    disabled={disabled}
                    extended={autoExpand.isExtended}
                    data-testid="stChatInputCancelButton"
                  >
                    <Icon content={Close} size="lg" color="inherit" />
                  </StyledSendIconButton>
                  {/* Approve button (✓ icon) */}
                  <StyledSendIconButton
                    onClick={() => {
                      handleRecordingApprove().catch(_error => {
                        // Error handling is done via controller events
                      })
                    }}
                    disabled={disabled}
                    extended={autoExpand.isExtended}
                    data-testid="stChatInputApproveButton"
                  >
                    <Icon content={Check} size="lg" color="inherit" />
                  </StyledSendIconButton>
                </>
              ) : (
                <>
                  {/* Mic button */}
                  {acceptAudio && (
                    <StyledSendIconButton
                      onClick={(e: React.MouseEvent) => {
                        handleMicClick(e).catch(_error => {
                          // Error handling is done via controller events
                        })
                      }}
                      disabled={disabled}
                      extended={autoExpand.isExtended}
                      data-testid="stChatInputMicButton"
                    >
                      <Icon content={Mic} size="xl" color="inherit" />
                    </StyledSendIconButton>
                  )}
                  {/* Send button */}
                  <StyledSendIconButton
                    onClick={handleSubmit}
                    disabled={!dirty || disabled}
                    extended={autoExpand.isExtended}
                    data-testid="stChatInputSubmitButton"
                  >
                    <Icon content={Send} size="xl" color="inherit" />
                  </StyledSendIconButton>
                </>
              )}
            </StyledSendIconButtonContainer>
          </StyledChatInput>
        )}
      </StyledChatInputContainer>
    </>
  )
}

export default memo(ChatInput)

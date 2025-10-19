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

import { block, text } from "./test-utils"
import { GetNodeByDeltaPathVisitor } from "./visitors/GetNodeByDeltaPathVisitor"

describe("BlockNode.visit", () => {
  it("calls visitBlockNode on the visitor", () => {
    const node = block([text("child1"), text("child2")])
    const mockVisitor = {
      visitElementNode: vi.fn().mockReturnValue("element-result"),
      visitBlockNode: vi.fn().mockReturnValue("block-result"),
      visitTransientNode: vi.fn().mockReturnValue("transient-result"),
    }

    const result = node.accept(mockVisitor)

    expect(mockVisitor.visitBlockNode).toHaveBeenCalledWith(node)
    expect(mockVisitor.visitElementNode).not.toHaveBeenCalled()
    expect(result).toEqual("block-result")
  })

  it("allows visitor to return the same node", () => {
    const node = block([text("child")])
    const identityVisitor = {
      visitElementNode: vi.fn(),
      visitBlockNode: vi.fn().mockReturnValue(node),
      visitTransientNode: vi.fn(),
    }

    const result = node.accept(identityVisitor)

    expect(result).toBe(node)
  })

  it("allows visitor to return undefined", () => {
    const node = block([text("child")])
    const nullVisitor = {
      visitElementNode: vi.fn(),
      visitBlockNode: vi.fn().mockReturnValue(undefined),
      visitTransientNode: vi.fn(),
    }

    const result = node.accept(nullVisitor)

    expect(result).toBeUndefined()
  })

  it("can return a modified BlockNode through visitor", () => {
    const originalNode = block([text("child1"), text("child2")])
    const transformVisitor = {
      visitElementNode: vi.fn(),
      visitBlockNode: vi.fn().mockReturnValue(block([text("transformed")])),
      visitTransientNode: vi.fn(),
    }

    const result = originalNode.accept(transformVisitor)

    expect(result).not.toBe(originalNode)
    expect(result.children).toHaveLength(1)
    expect(GetNodeByDeltaPathVisitor.getNodeAtPath(result, [0])).toBeTextNode(
      "transformed"
    )
  })
})

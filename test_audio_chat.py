# Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2025)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import streamlit as st

st.title("Test Audio in Chat Input")

# Test with accept_audio=True
prompt = st.chat_input(
    "Say or record something",
    accept_file="multiple",
    accept_audio=True,
)

if prompt:
    st.write("### Return value type:", type(prompt))
    st.write("### Return value:", prompt)

    if hasattr(prompt, "text"):
        st.write("**Text:**", prompt.text)

    if hasattr(prompt, "audio"):
        st.write("**Audio:**", prompt.audio)
        if prompt.audio:
            st.audio(prompt.audio)

    if hasattr(prompt, "files"):
        st.write("**Files:**", prompt.files)
        for file in prompt.files:
            st.write(f"- {file.name}")

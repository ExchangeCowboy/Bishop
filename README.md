# Bishop
<img width="1373" height="389" alt="image" src="https://github.com/user-attachments/assets/13fdc228-e608-4ff2-a859-be206cd624c5" />

**What is Bishop?**

Bishop is my lightweight and custom Agent. Written largely by Codex in Node.js and Typescript, Bishop is intended to be fast. Guiding principles for Bishop are speed, customization, and minimal context usage.

Currently Bishop requires 
     - The ChatGPT app / Codex to be installed on your PC.
     - Windows OS
     - Nodejs
Check installation.md for detailed steps.

**Why do you call it Bishop?**

I call him Bishop because on the board, the Bishop approaches things from angles, get it? ^_^

**Why use Bishop?**

Bishop is designed to be modified by the user. Clear TOML config files, easy to understand directory architecture, and built-in self development guardrails allows you to transform Bishop into what you need it to be.

Bishop also has extra work done on its personal memory management. It uses SQL lite and when the conversation count gets too high, Bishop will ask you if you want it incorporated into the memory database. 

<img width="1637" height="276" alt="image" src="https://github.com/user-attachments/assets/0c58cbf1-b4a0-4cc8-903a-69188f3b5400" />

**Why not Bishop?**

Bishop is not designed for someone who doesn't have a good understanding of AI, agents, context windows, and system operations. Yes, he will work out of the box, but there are zero guardrails built around him. This is by design as bishop is built for speed. It is strongly recommended that before you deploy him, your process should be thoroughly tested and rock-solid. You are expected to understand what guardrails are, and how to implement and test them. This does not mean you need to be a developer. An experienced systems engineer (OS, Infrastructure, etc) should be able to work with Bishop to build the solution required.

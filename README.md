# Project Overview

This project is a chatbot application template built with Next.js, designed to facilitate the rapid development of AI-powered chat interfaces. It integrates authentication, data persistence, and support for multiple AI model providers, offering a foundation for building custom conversational AI solutions.

# Technologies Used in the Project

- **Next.js** (App Router, React Server Components, Server Actions)
- **React** (client-side interactivity)
- **AI SDK** (unified API for LLMs, supports xAI, OpenAI, Fireworks, and more)
- **Convex** (backend data persistence, agent framework, authentication)
- **shadcn/ui** and **Radix UI** (UI components and accessibility)
- **Tailwind CSS** (styling)
- **Auth.js** (authentication)
- **Vercel** (deployment, environment management)
- **TypeScript** (type safety)
- **Zod** (schema validation)
- **CodeMirror** (code editing in chat)

# Configuring the Project

1. Clone the repository.
2. Install dependencies using `pnpm install`.
3. Set up environment variables as defined in `.env.example` (or use Vercel's environment management).
4. (Optional) Link your project to Vercel for deployment and environment variable management.

# Running the Project in Development Mode

1. Ensure all dependencies are installed:  
   `pnpm install`
2. Start the development server:  
   `pnpm dev`
3. The application will be available at [http://localhost:3000](http://localhost:3000).

# Highlights

- Modular chat interface with support for attachments and multimodal input.
- Pluggable AI model providers via the AI SDK.
- Secure authentication and protected routes using Convex and Auth.js.
- Real-time chat history and user data persistence.
- Modern, accessible UI components with shadcn/ui and Radix UI.
- Designed for easy deployment to Vercel.

'use server';

import { z } from 'zod';

const authFormSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  flow: z.enum(['signIn', 'signUp', 'reset']).optional().default('signIn'),
});

export interface LoginActionState {
  status: 'idle' | 'in_progress' | 'success' | 'failed' | 'invalid_data';
  data?:FormData
}

export interface RegisterActionState {
  status:
    | 'idle'
    | 'in_progress'
    | 'success'
    | 'failed'
    | 'user_exists'
    | 'invalid_data';
      data?:FormData
}

export const login = async (
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState > => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
      flow:formData.get("flow")
    });

    return { status: 'success',  data: formData};
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data' };
    }

    return { status: 'failed' };
  }
};

export const register = async (
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
      flow:formData.get("flow")
    });
    return { status: 'success' ,data:formData};
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data' };
    }

    return { status: 'failed' };
  }
};

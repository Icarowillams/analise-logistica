import React from 'react';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-4">
      <img
        src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png"
        alt="Pão & Mel"
        className="w-64 h-auto mb-8"
      />
      <h1 className="text-3xl sm:text-4xl font-bold text-neutral-800 mb-3">
        Bem-vindo ao Pão & Mel
      </h1>
      <p className="text-lg text-neutral-500 max-w-md">
        Sistema de gestão comercial
      </p>
    </div>
  );
}
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function Vendedores() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(createPageUrl('Funcionarios'), { replace: true });
  }, []);
  return null;
}
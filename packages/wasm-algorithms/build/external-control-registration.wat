(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/registration-att/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/registration-att/abi_version))
 (export "run" (func $assembly/registration-att/run))
 (export "memory" (memory $0))
 (func $assembly/registration-att/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 f64)
  (local $5 f64)
  (local $6 f64)
  (local $7 f64)
  (local $8 f64)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 f64)
  (local $14 i32)
  (local $15 f64)
  (local $16 f64)
  (local $17 f64)
  (local $18 f64)
  (local $19 f64)
  local.get $0
  i32.const 0
  i32.lt_s
  local.get $1
  i32.const 0
  i32.le_s
  i32.or
  local.get $2
  i32.const 1
  i32.ne
  i32.or
  local.get $3
  i32.const 1024
  i32.le_s
  i32.or
  if
   i32.const 5
   return
  end
  local.get $1
  i32.const 1024
  i32.add
  local.tee $11
  local.get $1
  i32.add
  i32.const 3
  i32.add
  i32.const -4
  i32.and
  local.set $12
  i32.const 0
  local.set $0
  i32.const 0
  local.set $2
  loop $for-loop|0
   local.get $1
   local.get $2
   i32.gt_s
   if
    i32.const 1
    local.get $2
    local.get $11
    i32.add
    i32.load8_u
    local.tee $9
    i32.const 1
    i32.ne
    i32.const 0
    local.get $9
    select
    local.get $2
    i32.const 1024
    i32.add
    i32.load8_u
    local.tee $14
    i32.const 1
    i32.ne
    i32.const 0
    local.get $14
    select
    select
    if
     i32.const 5
     return
    end
    block $for-continue|0
     local.get $14
     i32.const 1
     i32.eq
     if
      local.get $0
      i32.const 1
      i32.add
      local.set $0
      local.get $7
      local.get $9
      f64.convert_i32_s
      f64.add
      local.set $7
      br $for-continue|0
     end
     local.get $12
     local.get $2
     i32.const 2
     i32.shl
     i32.add
     i32.load
     local.tee $14
     i32.const 0
     i32.le_s
     if
      i32.const 5
      return
     end
     local.get $10
     i32.const 1
     i32.add
     local.set $10
     local.get $8
     local.get $9
     f64.convert_i32_s
     local.get $14
     f64.convert_i32_s
     f64.const 0.0000152587890625
     f64.mul
     local.tee $13
     f64.mul
     f64.add
     local.set $8
     local.get $5
     local.get $13
     f64.add
     local.set $5
     local.get $6
     local.get $13
     local.get $13
     f64.mul
     f64.add
     local.set $6
    end
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|0
   end
  end
  local.get $10
  i32.eqz
  local.get $0
  i32.eqz
  i32.or
  local.get $5
  f64.const 0
  f64.le
  i32.or
  if
   i32.const 5
   return
  end
  local.get $7
  local.get $0
  f64.convert_i32_s
  f64.div
  local.tee $7
  local.get $8
  local.get $5
  f64.div
  local.tee $8
  f64.sub
  local.set $13
  local.get $8
  f64.const 0
  f64.le
  if
   i32.const 5
   return
  end
  local.get $7
  local.get $8
  f64.div
  local.set $15
  i32.const 0
  local.set $2
  loop $for-loop|1
   local.get $1
   local.get $2
   i32.gt_s
   if
    local.get $2
    i32.const 1024
    i32.add
    i32.load8_u
    i32.eqz
    if
     local.get $4
     local.get $12
     local.get $2
     i32.const 2
     i32.shl
     i32.add
     i32.load
     f64.convert_i32_s
     f64.const 0.0000152587890625
     f64.mul
     local.tee $4
     local.get $4
     f64.mul
     local.get $2
     local.get $11
     i32.add
     i32.load8_u
     f64.convert_i32_u
     local.get $8
     f64.sub
     local.tee $4
     f64.mul
     local.get $4
     f64.mul
     f64.add
     local.set $4
    end
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|1
   end
  end
  local.get $7
  f64.const 1
  local.get $7
  f64.sub
  local.tee $16
  f64.mul
  local.get $0
  f64.convert_i32_s
  local.tee $17
  f64.div
  local.get $4
  local.get $5
  local.get $5
  f64.mul
  local.tee $5
  f64.div
  local.tee $4
  f64.add
  f64.sqrt
  local.set $18
  local.get $5
  local.get $6
  f64.div
  local.set $19
  local.get $16
  local.get $17
  local.get $7
  f64.mul
  f64.div
  local.get $4
  local.get $8
  local.get $8
  f64.mul
  f64.div
  f64.add
  f64.sqrt
  local.tee $16
  f64.const -1.959963984540054
  f64.mul
  local.set $4
  f64.const 1
  local.set $6
  f64.const 1
  local.set $5
  i32.const 1
  local.set $1
  loop $for-loop|00
   local.get $1
   i32.const 12
   i32.le_s
   if
    local.get $5
    local.get $6
    local.get $4
    f64.mul
    local.get $1
    f64.convert_i32_s
    f64.div
    local.tee $6
    f64.add
    local.set $5
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|00
   end
  end
  local.get $15
  local.get $5
  f64.mul
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  local.set $2
  local.get $16
  f64.const 1.959963984540054
  f64.mul
  local.set $4
  f64.const 1
  local.set $6
  f64.const 1
  local.set $5
  i32.const 1
  local.set $1
  loop $for-loop|01
   local.get $1
   i32.const 12
   i32.le_s
   if
    local.get $5
    local.get $6
    local.get $4
    f64.mul
    local.get $1
    f64.convert_i32_s
    f64.div
    local.tee $6
    f64.add
    local.set $5
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|01
   end
  end
  local.get $15
  local.get $5
  f64.mul
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  local.set $1
  local.get $7
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $3
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  i32.store
  local.get $8
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $3
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  i32.store offset=4
  local.get $13
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $3
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  i32.store offset=8
  local.get $15
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $3
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  i32.store offset=12
  local.get $13
  local.get $18
  f64.const 1.959963984540054
  f64.mul
  f64.sub
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $3
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  i32.store offset=16
  local.get $13
  local.get $18
  f64.const 1.959963984540054
  f64.mul
  f64.add
  f64.const 65536
  f64.mul
  local.tee $4
  f64.const 2147483647
  f64.gt
  if
   f64.const 2147483647
   local.set $4
  end
  local.get $4
  f64.const -2147483648
  f64.lt
  if
   f64.const -2147483648
   local.set $4
  end
  local.get $3
  local.get $4
  f64.ceil
  local.tee $5
  local.get $5
  f64.const -1
  f64.add
  local.get $5
  f64.const -0.5
  f64.add
  local.get $4
  f64.le
  select
  i32.trunc_sat_f64_s
  i32.store offset=20
  local.get $3
  local.get $2
  i32.store offset=24
  local.get $3
  local.get $1
  i32.store offset=28
  local.get $3
  local.get $0
  f64.convert_i32_s
  local.get $19
  f64.add
  f64.store offset=40
  local.get $3
  local.get $0
  i32.store offset=48
  local.get $3
  local.get $10
  i32.store offset=52
  i32.const 0
 )
)
